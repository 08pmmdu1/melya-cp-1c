import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const isWindows = process.platform === 'win32';

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

export function rmrf(target) {
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

export function humanBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 || v >= 10 ? 0 : 1)} ${units[i]}`;
}

export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const rs = fs.createReadStream(file);
    rs.on('error', reject);
    rs.on('data', (d) => hash.update(d));
    rs.on('end', () => resolve(hash.digest('hex')));
  });
}

export function which(cmd) {
  const probe = isWindows ? 'where' : 'which';
  const res = spawnSync(probe, [cmd], { encoding: 'utf8', windowsHide: true });
  if (res.error || res.status !== 0) return null;
  const first = String(res.stdout || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)[0];
  return first || null;
}

export function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', windowsHide: true, ...opts });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(' ')} завершился с кодом ${res.status}`);
  return res;
}

export function trySpawn(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true });
  return { ok: !res.error && res.status === 0, res };
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Скачивает файл по url в dest, следуя редиректам GitHub. */
export function download(url, dest, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const attempt = (u, redirects) => {
      if (redirects > 10) {
        reject(new Error(`Слишком много перенаправлений при загрузке ${url}`));
        return;
      }
      const mod = u.startsWith('http:') ? http : https;
      const req = mod.get(
        u,
        { headers: { 'user-agent': 'mcp-1c-bundle', accept: '*/*' } },
        (res) => {
          const code = res.statusCode || 0;
          if (code >= 300 && code < 400 && res.headers.location) {
            res.resume();
            attempt(new URL(res.headers.location, u).toString(), redirects + 1);
            return;
          }
          if (code !== 200) {
            res.resume();
            reject(new Error(`HTTP ${code} при загрузке ${u}`));
            return;
          }
          const total = Number(res.headers['content-length'] || 0);
          let got = 0;
          ensureDir(path.dirname(dest));
          const out = fs.createWriteStream(dest);
          res.on('data', (chunk) => {
            got += chunk.length;
            if (onProgress) onProgress(got, total);
          });
          res.on('error', reject);
          out.on('error', reject);
          out.on('close', () => resolve({ bytes: got }));
          res.pipe(out);
        },
      );
      req.on('error', reject);
      req.setTimeout(180000, () => req.destroy(new Error('Таймаут загрузки')));
    };
    attempt(url, 0);
  });
}

/** Ищет java: --java -> --java-home -> JAVA_HOME -> PATH -> стандартные каталоги JDK. */
export function findJava(opts = {}) {
  if (opts.java) return opts.java;
  const exe = isWindows ? 'java.exe' : 'java';
  if (opts.javaHome) {
    const p = path.join(opts.javaHome, 'bin', exe);
    if (exists(p)) return p;
  }
  if (process.env.JAVA_HOME) {
    const p = path.join(process.env.JAVA_HOME, 'bin', exe);
    if (exists(p)) return p;
  }
  const onPath = which('java');
  if (onPath) return onPath;
  if (isWindows) {
    const roots = [
      'C:\\Program Files\\Java',
      'C:\\Program Files\\Eclipse Adoptium',
      'C:\\Program Files\\Microsoft',
      'C:\\Program Files\\Zulu',
      'C:\\Program Files\\BellSoft',
      'C:\\Program Files\\Amazon Corretto',
    ];
    const found = [];
    for (const root of roots) {
      if (!exists(root)) continue;
      for (const name of fs.readdirSync(root)) {
        const p = path.join(root, name, 'bin', exe);
        if (exists(p)) found.push(p);
      }
    }
    if (found.length) {
      found.sort();
      return found[found.length - 1];
    }
  }
  return 'java';
}

export function findFileByName(root, name) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.toLowerCase() === name.toLowerCase()) return full;
    }
  }
  return null;
}
