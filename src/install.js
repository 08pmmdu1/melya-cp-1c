import fs from 'node:fs';
import path from 'node:path';
import {
  download,
  ensureDir,
  exists,
  rmrf,
  sha256File,
  humanBytes,
  trySpawn,
  isWindows,
  findFileByName,
} from './util.js';
import { latestRelease } from './github.js';
import { archiveType, nativeBinName, platformKey } from './manifest.js';

/** Определяет релиз сервера: зафиксированная версия (по умолчанию) или latest из GitHub API. */
export async function resolveRelease(server, { pin, latest } = {}) {
  if (server.kind === 'remote') return null;
  const pinned = pin || server.release.version;
  if (latest) {
    const rel = await latestRelease(server.release.repo);
    const tag = rel.tag_name;
    const version = String(tag).replace(/^v/, '');
    const pattern = server.release.pattern();
    if (!pattern) throw new Error(`Платформа ${platformKey()} не поддерживается для ${server.id}`);
    const asset = (rel.assets || []).find((a) => pattern.test(a.name));
    if (!asset) {
      const names = (rel.assets || []).map((a) => a.name).join(', ') || '(нет артефактов)';
      throw new Error(`В релизе ${tag} (${server.release.repo}) нет подходящего артефакта. Доступно: ${names}`);
    }
    return {
      version,
      tag,
      repo: server.release.repo,
      assetName: asset.name,
      url: asset.browser_download_url,
      digest: asset.digest || null,
    };
  }
  const assetName = server.release.asset(pinned);
  if (!assetName) throw new Error(`Платформа ${platformKey()} не поддерживается для ${server.id}`);
  const tag = server.release.tag(pinned);
  const url = `https://github.com/${server.release.repo}/releases/download/${tag}/${assetName}`;
  return { version: pinned, tag, repo: server.release.repo, assetName, url, digest: null };
}

function extractArchive(file, dest, type, log) {
  ensureDir(dest);
  const attempt = trySpawn('tar', ['-xf', file, '-C', dest]);
  if (attempt.ok) return;
  if (type === 'zip' && !isWindows) {
    const uz = trySpawn('unzip', ['-oq', file, '-d', dest]);
    if (uz.ok) return;
  }
  if (type === 'zip' && isWindows) {
    const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const cmd =
      `Expand-Archive -LiteralPath '${file.replace(/'/g, "''")}' ` +
      `-DestinationPath '${dest.replace(/'/g, "''")}' -Force`;
    const res = trySpawn(ps, ['-NoProfile', '-NonInteractive', '-Command', cmd]);
    if (res.ok) return;
  }
  const detail = attempt.res && !attempt.res.error ? `tar код ${attempt.res.status}` : 'tar недоступен';
  throw new Error(`Не удалось распаковать ${path.basename(file)} (${type}); ${detail}`);
}

function placeFromLocal(dir, server, src, log) {
  const archive = archiveType(src);
  if (archive === 'none') {
    const target = path.join(dir, path.basename(src));
    if (path.resolve(target) !== path.resolve(src)) fs.copyFileSync(src, target);
    if (server.kind === 'native' && !isWindows) {
      try {
        fs.chmodSync(target, 0o755);
      } catch {
        /* ignore */
      }
    }
    log(`Использую локальный файл: ${path.basename(src)}`);
    return { artifact: target, version: 'local', tag: 'local', source: src, sha256: null };
  }
  const extractDir = path.join(dir, 'extract');
  rmrf(extractDir);
  extractArchive(src, extractDir, archive, log);
  const bin = nativeBinName();
  const found = findFileByName(extractDir, bin);
  if (!found) throw new Error(`В архиве ${path.basename(src)} не найден ${bin}`);
  const target = path.join(dir, bin);
  rmrf(target);
  fs.copyFileSync(found, target);
  if (!isWindows) {
    try {
      fs.chmodSync(target, 0o755);
    } catch {
      /* ignore */
    }
  }
  rmrf(extractDir);
  return { artifact: target, version: 'local', tag: 'local', source: src, sha256: null };
}

/** Скачивает (или берёт локальный файл) и размещает артефакт сервера. */
export async function installServer(root, server, { release, from, force, log, progress }) {
  const dir = path.join(root, server.id);
  ensureDir(dir);

  if (from) return placeFromLocal(dir, server, from, log);

  const archive = archiveType(release.assetName);
  const tempFile = path.join(dir, release.assetName);
  if (force || !exists(tempFile)) {
    log(`Скачиваю ${release.repo} ${release.tag} → ${release.assetName}`);
    const res = await download(release.url, tempFile, { onProgress: progress });
    log(`Загружено ${humanBytes(res.bytes)}`);
  } else {
    log(`Уже загружено: ${release.assetName} (пропускаю; --force чтобы перекачать)`);
  }

  const digest = await sha256File(tempFile);
  if (release.digest && release.digest.startsWith('sha256:')) {
    const want = release.digest.slice('sha256:'.length);
    if (want && want.toLowerCase() !== digest.toLowerCase()) {
      rmrf(tempFile);
      throw new Error(`Checksum не совпал для ${release.assetName}: ожидался ${want}, получен ${digest}`);
    }
    log('SHA-256 совпал с данными релиза.');
  }

  if (archive === 'none') {
    return { artifact: tempFile, version: release.version, tag: release.tag, source: release.url, sha256: digest };
  }

  const extractDir = path.join(dir, 'extract');
  rmrf(extractDir);
  log(`Распаковываю ${release.assetName} (${archive})…`);
  extractArchive(tempFile, extractDir, archive, log);
  const bin = nativeBinName();
  const found = findFileByName(extractDir, bin);
  if (!found) throw new Error(`В архиве ${release.assetName} не найден ${bin}`);
  const target = path.join(dir, bin);
  rmrf(target);
  fs.copyFileSync(found, target);
  if (!isWindows) {
    try {
      fs.chmodSync(target, 0o755);
    } catch {
      /* ignore */
    }
  }
  rmrf(extractDir);
  return { artifact: target, version: release.version, tag: release.tag, source: release.url, sha256: digest };
}

export function stateFile(root) {
  return path.join(root, 'install-state.json');
}

export function readState(root) {
  const file = stateFile(root);
  if (!exists(file)) return { servers: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { servers: parsed.servers || {} };
  } catch {
    return { servers: {} };
  }
}

export function writeState(root, state) {
  ensureDir(root);
  fs.writeFileSync(stateFile(root), JSON.stringify(state, null, 2), 'utf8');
}
