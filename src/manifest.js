/**
 * Декларативный манифест набора MCP-серверов.
 *
 * Каждый сервер описывает:
 *  - kind:    'java'   — запуск через java -jar (скачивается один .jar)
 *             'native' — скачивается архив (.zip / .tar.gz), из него берётся исполняемый файл
 *             'remote' — ничего не скачивается, только прописывается URL
 *  - release: repo / version / tag(v) / asset(v) / pattern() для выбора артефакта
 *  - args:    (ctx) => хвост командной строки
 *  - env:     (ctx) => переменные окружения (для native)
 *
 * ctx: { java, platformPath, repos: [{alias, path}], indexHome, buddyUrl, buddyTimeout }
 */

export function platformKey() {
  if (process.platform === 'win32') return 'win32';
  if (process.platform === 'linux') return 'linux';
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'darwin_arm64' : 'darwin_x64';
  return process.platform;
}

export function archiveType(fileName) {
  const n = String(fileName).toLowerCase();
  if (n.endsWith('.tar.gz') || n.endsWith('.tgz')) return 'tar.gz';
  if (n.endsWith('.zip')) return 'zip';
  return 'none';
}

export function nativeBinName() {
  return platformKey() === 'win32' ? 'bsl-indexer.exe' : 'bsl-indexer';
}

const CODE_INDEX_ASSET = {
  win32: 'bsl-indexer-windows-x64.zip',
  linux: 'bsl-indexer-linux-x64.tar.gz',
  darwin_arm64: 'bsl-indexer-macos-arm64.tar.gz',
};

const CODE_INDEX_PATTERN = {
  win32: /^bsl-indexer-windows-x64\.zip$/,
  linux: /^bsl-indexer-linux-x64\.tar\.gz$/,
  darwin_arm64: /^bsl-indexer-macos-arm64\.tar\.gz$/,
};

export const SERVERS = [
  {
    id: 'bsl-platform-server',
    aliases: ['bsl-ls', 'lsp', 'bsl-language-server'],
    title: 'BSL Language Server (MCP) — разбор и навигация по одному .bsl-файлу',
    kind: 'java',
    release: {
      repo: '1c-syntax/bsl-language-server',
      version: '1.0.7',
      tag: (v) => `v${v}`,
      asset: (v) => `bsl-language-server-${v}-exec.jar`,
      pattern: () => /^bsl-language-server-.+-exec\.jar$/,
    },
    args: () => ['mcp'],
    note: 'Требуется Java (17+). Артефакт ~130 МБ.',
  },
  {
    id: 'bsl-platform-context',
    aliases: ['bsl-context', 'context', 'platform-context'],
    title: 'BSL Platform Context (MCP) — справка по API платформы 1С',
    kind: 'java',
    release: {
      repo: 'alkoleft/mcp-bsl-platform-context',
      version: '0.3.2',
      tag: (v) => `v${v}`,
      asset: (v) => `mcp-bsl-context-${v}.jar`,
      pattern: () => /^mcp-bsl-context-.+\.jar$/,
    },
    args: (ctx) => ['--mode', 'stdio', '--platform-path', ctx.platformPath],
    requires: ['platformPath'],
    note: 'Нужен путь к установленной платформе 1С: --platform-path.',
  },
  {
    id: 'code-index',
    aliases: ['index', 'bsl-indexer', 'code-index-mcp'],
    title: 'code-index (bsl-indexer) — индекс всей конфигурации 1С',
    kind: 'native',
    release: {
      repo: 'Regsorm/code-index-mcp',
      version: '1.14.0',
      tag: (v) => `v${v}`,
      asset: () => CODE_INDEX_ASSET[platformKey()],
      pattern: () => CODE_INDEX_PATTERN[platformKey()],
    },
    args: (ctx) => ['serve', ...ctx.repos.flatMap((r) => ['--path', `${r.alias}=${r.path}`])],
    env: (ctx) => ({ CODE_INDEX_HOME: ctx.indexHome }),
    note: 'Реестр баз: --repo alias=путь (можно несколько). CODE_INDEX_HOME задаётся автоматически.',
  },
  {
    id: 'onec-buddy-mcp',
    aliases: ['buddy', 'onec-buddy'],
    title: 'onec-buddy (1С:Напарник) — документация, ИТС, проверка кода',
    kind: 'remote',
    release: null,
    url: (ctx) => ctx.buddyUrl,
    timeout: (ctx) => ctx.buddyTimeout,
    note: 'Скачивание не требуется: сервис запускается отдельно (Docker) и доступен по URL.',
  },
];

export function byId(id) {
  return SERVERS.find((s) => s.id === id || (s.aliases || []).includes(id)) || null;
}

export function resolveSelection({ only, skip }) {
  const expand = (list) =>
    list.flatMap((raw) => {
      const server = byId(raw);
      if (!server) throw new Error(`Неизвестный сервер: ${raw}. Доступны: ${SERVERS.map((s) => s.id).join(', ')}`);
      return [server.id];
    });
  const onlyIds = only.length ? new Set(expand(only)) : null;
  const skipIds = new Set(expand(skip));
  return SERVERS.filter((s) => (onlyIds ? onlyIds.has(s.id) : true) && !skipIds.has(s.id));
}
