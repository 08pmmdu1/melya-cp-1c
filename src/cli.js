import path from 'node:path';
import os from 'node:os';
import { SERVERS, byId, resolveSelection, platformKey, nativeBinName } from './manifest.js';
import { installServer, resolveRelease, readState, writeState } from './install.js';
import { findJava, humanBytes, exists, ensureDir } from './util.js';
import { readConfigText, readExistingMcp, upsertMcp, writeConfig } from './config.js';

const VERSION = '1.0.0';

const VALUE_OPTS = new Set([
  'dir',
  'config',
  'java',
  'java-home',
  'platform-path',
  'index-home',
  'project',
  'buddy-url',
  'buddy-timeout',
]);
const REPEAT_OPTS = new Set(['repo', 'from', 'pin', 'only', 'skip']);
const BOOL_OPTS = new Set(['latest', 'force', 'no-config', 'dry-run', 'json', 'verify', 'help', 'h', 'yes', 'no-backup']);
const COMMANDS = new Set(['install', 'list', 'print', 'doctor', 'help']);

function parseArgs(argv) {
  const out = {
    command: 'install',
    values: {},
    repeats: { repo: [], from: [], pin: [], only: [], skip: [] },
    flags: {},
  };
  let commandSet = false;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('-')) {
      const cmd = token.toLowerCase();
      if (!commandSet && COMMANDS.has(cmd)) {
        out.command = cmd;
        commandSet = true;
        continue;
      }
      throw new Error(`Неизвестная команда или аргумент: ${token}`);
    }
    let name = token.replace(/^--?/, '');
    let inline = null;
    const eq = name.indexOf('=');
    if (eq >= 0) {
      inline = name.slice(eq + 1);
      name = name.slice(0, eq);
    }
    if (BOOL_OPTS.has(name)) {
      out.flags[name] = true;
      continue;
    }
    if (VALUE_OPTS.has(name) || REPEAT_OPTS.has(name)) {
      const value = inline !== null ? inline : argv[++i];
      if (value === undefined) throw new Error(`Опция --${name} требует значение`);
      if (REPEAT_OPTS.has(name)) out.repeats[name].push(value);
      else out.values[name] = value;
      continue;
    }
    throw new Error(`Неизвестная опция: ${token}`);
  }
  return out;
}

function usage() {
  return `
mcp-1c-bundle ${VERSION} — установка набора MCP-серверов для 1С/BSL одной командой.

Использование:
  mcp-1c-bundle [install] [опции]     скачать серверы и прописать блок mcp в kilo.jsonc
  mcp-1c-bundle list                  показать серверы, версии и статус установки
  mcp-1c-bundle print [опции]         напечатать JSON-блок mcp, ничего не скачивая
  mcp-1c-bundle doctor [опции]        проверить окружение (java, файлы, конфиг)

Основные опции:
  --dir <path>            каталог для скачанных серверов (по умолчанию ~/.mcp-1c-bundle)
  --config <path>         путь к kilo.jsonc (по умолчанию ~/.config/kilo/kilo.jsonc)
  --java <path>           путь к java.exe; иначе JAVA_HOME / PATH / автопоиск JDK
  --java-home <path>      каталог JDK
  --platform-path <path>  каталог платформы 1С (для bsl-platform-context), напр. "C:\\Program Files\\1cv8\\8.3.27.1326"
  --project <path>        проект 1С для индексации (по умолчанию текущий каталог)
  --repo <alias=path>     регистр баз code-index; можно несколько раз
  --index-home <path>     CODE_INDEX_HOME для code-index (по умолчанию <dir>/code-index)
  --buddy-url <url>       URL сервиса onec-buddy (по умолчанию http://localhost:6002/mcp)
  --latest                взять последние версии релизов через GitHub API (медленнее, возможен лимит)
  --pin <id>=<version>    зафиксировать версию сервера; можно несколько раз
  --from <id>=<path>      поставить сервер из локального файла вместо GitHub
  --only <id>             обрабатывать только указанные серверы (можно несколько)
  --skip <id>             исключить серверы (можно несколько)
  --force                 перекачать артефакты заново
  --no-config             только скачать, конфиг не трогать (покажет блок)
  --dry-run               показать план, ничего не делать
  --no-backup             не делать .bak рядом с конфигом
  --json                  машинно-читаемый вывод (для print/install)
  -h, --help              эта справка

Серверы (id / алиасы):
${SERVERS.map((s) => `  ${s.id.padEnd(20)} ${(s.aliases || []).join(', ')}`).join('\n')}

Пример:
  mcp-1c-bundle install --platform-path "C:\\Program Files\\1cv8\\8.3.27.1326" \\
    --java "C:\\Program Files\\Java\\jdk-26.0.2.1\\bin\\java.exe" \\
    --project "D:\\Projects\\1с\\AITestVS" --index-home "C:\\tools\\code-index"
`.trim();
}

function defaultDir(values) {
  return values.dir ? path.resolve(values.dir) : path.join(os.homedir(), '.mcp-1c-bundle');
}

function defaultConfig(values) {
  if (values.config) return path.resolve(values.config);
  return path.join(os.homedir(), '.config', 'kilo', 'kilo.jsonc');
}

function buildRepos(values, repeats) {
  if (repeats.repo.length) {
    return repeats.repo.map((raw) => {
      const eq = raw.indexOf('=');
      if (eq < 0) {
        const value = path.resolve(raw);
        return { alias: path.basename(value).toLowerCase(), path: value };
      }
      return { alias: raw.slice(0, eq).trim(), path: path.resolve(raw.slice(eq + 1).trim()) };
    });
  }
  const project = path.resolve(values.project || process.cwd());
  return [{ alias: path.basename(project).toLowerCase() || 'default', path: project }];
}

function parsePins(repeats) {
  const pins = {};
  for (const raw of repeats.pin) {
    const m = /^([^=@]+)[=@](.+)$/.exec(raw);
    if (!m) throw new Error(`--pin ожидает id=version, получено: ${raw}`);
    const server = byId(m[1].trim());
    if (!server) throw new Error(`--pin: неизвестный сервер ${m[1]}`);
    pins[server.id] = m[2].trim();
  }
  return pins;
}

function parseFroms(repeats) {
  const froms = {};
  for (const raw of repeats.from) {
    const eq = raw.indexOf('=');
    if (eq < 0) throw new Error(`--from ожидает id=path, получено: ${raw}`);
    const server = byId(raw.slice(0, eq).trim());
    if (!server) throw new Error(`--from: неизвестный сервер ${raw.slice(0, eq)}`);
    froms[server.id] = path.resolve(raw.slice(eq + 1).trim());
  }
  return froms;
}

function buildContext(args) {
  const { values, repeats } = args;
  const dir = defaultDir(values);
  const java = findJava({ java: values.java, javaHome: values['java-home'] });
  const indexHome = values['index-home'] ? path.resolve(values['index-home']) : path.join(dir, 'code-index');
  return {
    dir,
    configFile: defaultConfig(values),
    java,
    platformPath: values['platform-path'] ? path.resolve(values['platform-path']) : null,
    repos: buildRepos(values, repeats),
    indexHome,
    buddyUrl: values['buddy-url'] || 'http://localhost:6002/mcp',
    buddyTimeout: Number(values['buddy-timeout'] || 300000),
    pins: parsePins(repeats),
    froms: parseFroms(repeats),
  };
}

function buildMcpBlock(servers, ctx, artifacts) {
  const mcp = {};
  for (const server of servers) {
    if (server.kind === 'remote') {
      mcp[server.id] = { type: 'remote', url: server.url(ctx), timeout: server.timeout(ctx), enabled: true };
      continue;
    }
    const artifact = artifacts[server.id];
    if (server.kind === 'java') {
      mcp[server.id] = {
        type: 'local',
        command: [ctx.java, '-Dfile.encoding=UTF-8', '-jar', artifact, ...server.args(ctx)],
        enabled: true,
      };
    } else {
      const entry = { type: 'local', command: [artifact, ...server.args(ctx)], enabled: true };
      const env = server.env ? server.env(ctx) : null;
      if (env && Object.keys(env).length) entry.environment = env;
      mcp[server.id] = entry;
    }
  }
  return mcp;
}

function artifactFor(server, ctx, state) {
  const recorded = state.servers[server.id];
  if (recorded && recorded.artifact) return recorded.artifact;
  if (server.kind === 'java') {
    const version = ctx.pins[server.id] || server.release.version;
    return path.join(ctx.dir, server.id, server.release.asset(version));
  }
  if (server.kind === 'native') return path.join(ctx.dir, server.id, nativeBinName());
  return null;
}

function makeProgressLogger(label) {
  let last = 0;
  return (got, total) => {
    const now = Date.now();
    if (now - last < 400 && got !== total) return;
    last = now;
    const pct = total ? ` (${Math.round((got / total) * 100)}%)` : '';
    process.stderr.write(`\r  ${label}: ${humanBytes(got)}${total ? ' / ' + humanBytes(total) : ''}${pct}   `);
    if (got === total) process.stderr.write('\n');
  };
}

function validateRequirements(servers, ctx) {
  const missing = [];
  for (const server of servers) {
    if ((server.requires || []).includes('platformPath') && !ctx.platformPath) {
      missing.push(`${server.id}: нужен --platform-path`);
    }
    if (server.kind === 'java' && !ctx.java) {
      missing.push(`${server.id}: не найден java`);
    }
  }
  if (missing.length) throw new Error('Не заданы обязательные параметры:\n  ' + missing.join('\n  '));
}

async function cmdList(ctx, args) {
  const state = readState(ctx.dir);
  const rows = SERVERS.map((s) => {
    const recorded = state.servers[s.id];
    const version = s.release ? s.release.version : '—';
    const installedVersion = recorded ? recorded.version : '';
    const artifact = recorded ? recorded.artifact : '';
    const ok = artifact && exists(artifact);
    return {
      id: s.id,
      kind: s.kind,
      version,
      installed: ok ? installedVersion || 'yes' : (recorded ? 'файла нет' : 'нет'),
      artifact,
      repo: s.release ? s.release.repo : '—',
    };
  });
  if (args.flags.json) {
    console.log(JSON.stringify({ dir: ctx.dir, servers: rows }, null, 2));
    return;
  }
  console.log(`Каталог установки: ${ctx.dir}`);
  console.log(`Конфиг: ${ctx.configFile}${exists(ctx.configFile) ? '' : ' (не найден)'}\n`);
  for (const r of rows) {
    console.log(`${r.id.padEnd(20)} версия ${String(r.version).padEnd(8)} установлен: ${r.installed}`);
    console.log(`  ${r.repo}`);
    if (r.artifact) console.log(`  ${r.artifact}`);
  }
}

async function cmdPrint(ctx, args) {
  const selection = resolveSelection(args.repeats);
  const state = readState(ctx.dir);
  const artifacts = {};
  for (const s of selection) artifacts[s.id] = artifactFor(s, ctx, state);
  const block = buildMcpBlock(selection, ctx, artifacts);
  const text = JSON.stringify({ mcp: block }, null, 2);
  if (args.flags.json) {
    console.log(JSON.stringify({ config: ctx.configFile, block }, null, 2));
  } else {
    console.log(`Файл конфигурации: ${ctx.configFile}`);
    console.log('Блок для вставки в kilo.jsonc:\n');
    console.log(text);
  }
}

async function cmdDoctor(ctx, args) {
  const selection = resolveSelection(args.repeats);
  const state = readState(ctx.dir);
  const problems = [];
  console.log('Проверка окружения:\n');
  console.log(`  ОС / платформа : ${process.platform} (${platformKey()})`);
  console.log(`  Node.js        : ${process.version}`);
  console.log(`  Каталог        : ${ctx.dir}${exists(ctx.dir) ? '' : ' (будет создан)'}`);

  const hasJava = selection.some((s) => s.kind === 'java');
  if (hasJava) {
    if (ctx.java && exists(ctx.java)) {
      console.log(`  Java           : ${ctx.java}`);
    } else if (ctx.java) {
      console.log(`  Java           : ${ctx.java}  (путь не найден — проверьте JAVA_HOME/--java)`);
      problems.push('java не найден по вычисленному пути');
    } else {
      problems.push('java не найден');
    }
  }
  if (selection.some((s) => (s.requires || []).includes('platformPath'))) {
    if (ctx.platformPath && exists(ctx.platformPath)) {
      console.log(`  Платформа 1С   : ${ctx.platformPath}`);
    } else {
      console.log(`  Платформа 1С   : ${ctx.platformPath || '—'}  (не задано: --platform-path)`);
      problems.push('не задан/не найден --platform-path');
    }
  }
  console.log(`  CODE_INDEX_HOME: ${ctx.indexHome}`);
  console.log(`  Регистры баз   : ${ctx.repos.map((r) => `${r.alias}=${r.path}`).join('; ')}`);
  console.log(`  onec-buddy URL : ${ctx.buddyUrl}`);
  console.log(`  Конфиг kilo    : ${ctx.configFile}${exists(ctx.configFile) ? '' : ' (не найден, будет создан)'}`);

  console.log('\nАртефакты:');
  for (const s of selection) {
    if (s.kind === 'remote') {
      console.log(`  ${s.id.padEnd(20)} remote — скачивание не требуется`);
      continue;
    }
    const artifact = artifactFor(s, ctx, state);
    const ok = exists(artifact);
    console.log(`  ${s.id.padEnd(20)} ${ok ? 'OK   ' : 'НЕТ  '} ${artifact}`);
    if (!ok) problems.push(`${s.id}: нет файла ${artifact}`);
  }

  if (problems.length) {
    console.log('\nПроблемы:');
    for (const p of problems) console.log(`  - ${p}`);
  } else {
    console.log('\nПроблем не найдено.');
  }
}

async function cmdInstall(ctx, args) {
  const selection = resolveSelection(args.repeats);
  validateRequirements(selection, ctx);

  console.log(`Каталог установки: ${ctx.dir}`);
  console.log(`Конфиг: ${ctx.configFile}`);
  console.log(`Серверы: ${selection.map((s) => s.id).join(', ')}\n`);

  if (args.flags['dry-run']) {
    const state = readState(ctx.dir);
    for (const s of selection) {
      if (s.kind === 'remote') {
        console.log(`  ${s.id}: remote → ${s.url(ctx)}`);
      } else {
        const release = await resolveRelease(s, { pin: ctx.pins[s.id], latest: args.flags.latest });
        console.log(`  ${s.id}: ${release.tag} → ${release.assetName}`);
        console.log(`    ${release.url}`);
        console.log(`    в ${artifactFor(s, ctx, state)}`);
      }
    }
    console.log('\n(dry-run — ничего не изменено)');
    return;
  }

  const state = readState(ctx.dir);
  const artifacts = {};

  for (const s of selection) {
    if (s.kind === 'remote') {
      console.log(`[${s.id}] remote — пропускаю скачивание (${s.url(ctx)})`);
      artifacts[s.id] = null;
      continue;
    }
    const from = ctx.froms[s.id];
    let release = null;
    if (!from) {
      release = await resolveRelease(s, { pin: ctx.pins[s.id], latest: args.flags.latest });
    }
    console.log(`[${s.id}] ${from ? 'локальный ' + from : release.tag + ' · ' + release.assetName}`);
    const result = await installServer(ctx.dir, s, {
      release,
      from,
      force: args.flags.force,
      log: (m) => console.log(`  ${m}`),
      progress: makeProgressLogger(s.id),
    });
    artifacts[s.id] = result.artifact;
    state.servers[s.id] = {
      version: result.version,
      tag: result.tag,
      repo: s.release ? s.release.repo : null,
      source: result.source,
      artifact: result.artifact,
      sha256: result.sha256,
      installedAt: new Date().toISOString(),
    };
    console.log(`  → ${result.artifact}\n`);
  }
  writeState(ctx.dir, state);

  const block = buildMcpBlock(selection, ctx, artifacts);

  if (args.flags['no-config']) {
    console.log('Конфиг не изменён (--no-config). Блок mcp:\n');
    console.log(JSON.stringify({ mcp: block }, null, 2));
    return;
  }

  const existingText = readConfigText(ctx.configFile);
  const existingMcp = readExistingMcp(existingText);
  const mergedMcp = { ...existingMcp, ...block };
  const base = existingText ?? '{\n  "$schema": "https://app.kilo.ai/config.json"\n}\n';
  const nextText = upsertMcp(base, mergedMcp);
  const written = writeConfig(ctx.configFile, nextText, { backup: !args.flags['no-backup'] });

  const kept = Object.keys(existingMcp).filter((k) => !(k in block));
  console.log(`Конфиг обновлён: ${written.file}`);
  if (written.backup) console.log(`Резервная копия: ${written.backup}`);
  if (kept.length) console.log(`Сохранены прежние серверы: ${kept.join(', ')}`);

  if (args.flags.json) {
    console.log(JSON.stringify({ config: written.file, backup: written.backup, mcp: block, artifacts }, null, 2));
    return;
  }

  console.log('\nГотово. Дальнейшие шаги:');
  console.log('  1. Перезапустите Kilo, чтобы он перечитал mcp-серверы.');
  if (selection.some((s) => s.id === 'code-index')) {
    console.log(`  2. code-index требует запущенного демона: "${path.join(ctx.dir, 'code-index', nativeBinName())}" daemon run`);
  }
  if (selection.some((s) => s.id === 'onec-buddy-mcp')) {
    console.log(`  3. onec-buddy — отдельный сервис; поднимите его (Docker) на ${ctx.buddyUrl.replace(/\/mcp\/?$/, '')}.`);
  }
}

export async function main(argv) {
  if (!argv.length) argv = ['help'];
  const args = parseArgs(argv);
  if (args.flags.help || args.flags.h || args.command === 'help') {
    console.log(usage());
    return;
  }
  const ctx = buildContext(args);
  ensureDir(ctx.dir);

  switch (args.command) {
    case 'list':
      await cmdList(ctx, args);
      break;
    case 'print':
      await cmdPrint(ctx, args);
      break;
    case 'doctor':
      await cmdDoctor(ctx, args);
      break;
    case 'install':
    default:
      await cmdInstall(ctx, args);
      break;
  }
}
