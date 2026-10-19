import fs from 'node:fs';
import path from 'node:path';
import { trySpawn, exists, rmrf, ensureDir } from './util.js';

/** Плоский парсер JSONC: убирает // и /* *​/ комментарии и висячие запятые. */
export function parseJsonc(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      out += c;
      i++;
      while (i < n) {
        const ch = text[i];
        out += ch;
        if (ch === '\\') {
          i++;
          if (i < n) {
            out += text[i];
            i++;
          }
          continue;
        }
        if (ch === '"') {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  out = out.replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(out);
}

function readString(text, start) {
  let j = start + 1;
  let value = '';
  const n = text.length;
  while (j < n) {
    const ch = text[j];
    if (ch === '\\') {
      value += text[j + 1] ?? '';
      j += 2;
      continue;
    }
    if (ch === '"') return { value, end: j + 1 };
    value += ch;
    j++;
  }
  return { value, end: j };
}

function skipWs(text, start) {
  let j = start;
  const n = text.length;
  while (j < n) {
    const ch = text[j];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      j++;
      continue;
    }
    if (ch === '/' && text[j + 1] === '/') {
      while (j < n && text[j] !== '\n') j++;
      continue;
    }
    if (ch === '/' && text[j + 1] === '*') {
      j += 2;
      while (j < n && !(text[j] === '*' && text[j + 1] === '/')) j++;
      j += 2;
      continue;
    }
    break;
  }
  return j;
}

/**
 * Находит корневой объект и свойства верхнего уровня, сохраняя позиции в исходном тексте.
 * Возвращает { rootOpen, rootClose, props: [{ key, keyStart, valueEnd }] }.
 */
export function locateTopLevel(text) {
  const n = text.length;
  let i = 0;
  let depth = 0;
  let rootOpen = -1;
  let rootClose = -1;
  const props = [];
  let pendingKey = null;
  let openValue = null;

  while (i < n) {
    const c = text[i];
    if (c === '"') {
      const strStart = i;
      const s = readString(text, i);
      i = s.end;
      const j = skipWs(text, i);
      if (depth === 1 && text[j] === ':') {
        pendingKey = { key: s.value, keyStart: strStart };
        i = j + 1;
        continue;
      }
      if (pendingKey && depth === 1) {
        props.push({ key: pendingKey.key, keyStart: pendingKey.keyStart, valueStart: strStart, valueEnd: i });
        pendingKey = null;
      }
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '{' || c === '[') {
      if (pendingKey && depth === 1) openValue = { prop: pendingKey };
      depth++;
      if (depth === 1 && c === '{') rootOpen = i;
      i++;
      continue;
    }
    if (c === '}' || c === ']') {
      depth--;
      if (depth === 0 && c === '}') rootClose = i;
      if (openValue && depth === 1) {
        props.push({
          key: openValue.prop.key,
          keyStart: openValue.prop.keyStart,
          valueStart: -1,
          valueEnd: i + 1,
        });
        openValue = null;
        pendingKey = null;
      }
      i++;
      continue;
    }
    if (c === ',') {
      pendingKey = null;
      i++;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (pendingKey && depth === 1) {
      const vs = i;
      while (i < n && !',}]'.includes(text[i]) && text[i] !== '\n' && text[i] !== '\r') {
        if (text[i] === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) break;
        i++;
      }
      let ve = i;
      while (ve > vs && /\s/.test(text[ve - 1])) ve--;
      props.push({ key: pendingKey.key, keyStart: pendingKey.keyStart, valueStart: vs, valueEnd: ve });
      pendingKey = null;
      continue;
    }
    i++;
  }
  return { rootOpen, rootClose, props };
}

function serializeValue(obj, keyIndent, unit) {
  const step = unit && unit > 0 ? unit : 2;
  const json = JSON.stringify(obj, null, step);
  const pad = ' '.repeat(keyIndent);
  return json
    .split('\n')
    .map((line, idx) => (idx === 0 ? line : pad + line))
    .join('\n');
}

function indentOf(text, index) {
  const lineStart = text.lastIndexOf('\n', index - 1) + 1;
  const m = /^[ \t]*/.exec(text.slice(lineStart, index));
  return m ? m[0].length : 2;
}

/**
 * Точечно заменяет/добавляет свойство "mcp" в JSONC-тексте, сохраняя остальное
 * содержимое (включая комментарии). Возвращает новый текст.
 */
export function upsertMcp(text, mcpObject) {
  const loc = locateTopLevel(text);
  if (loc.rootOpen < 0) throw new Error('Не найден корневой объект JSON в файле конфигурации');
  const mcpProp = loc.props.find((p) => p.key === 'mcp');
  if (mcpProp) {
    const indent = indentOf(text, mcpProp.keyStart);
    const serialized = serializeValue(mcpObject, indent, indent);
    return text.slice(0, mcpProp.keyStart) + '"mcp": ' + serialized + text.slice(mcpProp.valueEnd);
  }
  const rootIndent = loc.props.length > 0 ? indentOf(text, loc.props[0].keyStart) : 2;
  const pad = ' '.repeat(rootIndent);
  const serialized = serializeValue(mcpObject, rootIndent, rootIndent);
  if (loc.props.length > 0) {
    const last = loc.props[loc.props.length - 1];
    return text.slice(0, last.valueEnd) + `,\n${pad}"mcp": ` + serialized + text.slice(last.valueEnd);
  }
  return text.slice(0, loc.rootOpen + 1) + `\n${pad}"mcp": ` + serialized + '\n' + text.slice(loc.rootOpen + 1);
}

/** Читает текст конфига (или null, если файла нет). */
export function readConfigText(file) {
  if (!exists(file)) return null;
  return fs.readFileSync(file, 'utf8');
}

/** Читает существующий блок mcp из конфига (или {} если нет). */
export function readExistingMcp(text) {
  if (!text) return {};
  try {
    const parsed = parseJsonc(text);
    return parsed && typeof parsed.mcp === 'object' && parsed.mcp ? parsed.mcp : {};
  } catch {
    return {};
  }
}

/**
 * Пишет конфиг с бэкапом. Возвращает { file, backup, merged }.
 * mergeMcp=true — сохраняет чужие серверы, перезаписывая только наши ключи.
 */
export function writeConfig(file, text, { backup = true } = {}) {
  ensureDir(path.dirname(file));
  let backupPath = null;
  if (backup && exists(file)) {
    backupPath = `${file}.${timestamp()}.bak`;
    fs.copyFileSync(file, backupPath);
  }
  fs.writeFileSync(file, text, 'utf8');
  return { file, backup: backupPath };
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export { rmrf };
