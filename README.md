# melya-cp-1c

Установка набора MCP-серверов для **1С:Предприятие / BSL** одной командой: пакет скачивает
готовые сборки серверов с GitHub Releases и прописывает блок `mcp` в `kilo.jsonc`.

## Что ставится

| id | Сервер | Источник | Тип | Версия по умолчанию |
|---|---|---|---|---|
| `bsl-platform-server` | BSL Language Server (MCP) — анализ и навигация по одному `.bsl` | `1c-syntax/bsl-language-server` | Java `.jar` | `1.0.7` |
| `bsl-platform-context` | Справка по API платформы 1С | `alkoleft/mcp-bsl-platform-context` | Java `.jar` | `0.3.2` |
| `code-index` | Индекс всей конфигурации (`bsl-indexer`) | `Regsorm/code-index-mcp` | native (`.zip`) | `1.14.0` |
| `onec-buddy-mcp` | 1С:Напарник — документация, ИТС, проверка кода | `ROCTUP/1c-buddy` | remote URL | `http://localhost:6002/mcp` |

`onec-buddy-mcp` не скачивается — это отдельный сервис (Docker); пакет только прописывает его URL.

## Быстрый старт

```powershell
# из каталога пакета
npm link            # или: node bin/melya-cp-1c.js <команда>

melya-cp-1c install `
  --platform-path "C:\Program Files\1cv8\8.3.27.1326" `
  --java "C:\Program Files\Java\jdk-26.0.2.1\bin\java.exe" `
  --project "D:\Projects\1с\AITestVS" `
  --index-home "C:\tools\code-index"
```

После установки перезапустите Kilo, чтобы он перечитал список MCP-серверов.

## Команды

| Команда | Назначение |
|---|---|
| `install` (по умолчанию) | скачать серверы и обновить `kilo.jsonc` |
| `print` | напечатать JSON-блок `mcp`, ничего не скачивая |
| `list` | показать серверы, версии и статус установки |
| `doctor` | проверить java, пути, файлы и конфиг |
| `help` | справка |

## Основные опции

| Опция | Описание |
|---|---|
| `--dir <path>` | каталог для скачанных серверов (по умолчанию `~/.melya-cp-1c`) |
| `--config <path>` | путь к `kilo.jsonc` (по умолчанию `~/.config/kilo/kilo.jsonc`) |
| `--java <path>` / `--java-home <path>` | путь к Java (иначе `JAVA_HOME` → `PATH` → автопоиск JDK) |
| `--platform-path <path>` | каталог платформы 1С — обязателен для `bsl-platform-context` |
| `--project <path>` | проект 1С для индексации (по умолчанию текущий каталог) |
| `--repo <alias=path>` | регистр баз `code-index`; можно несколько раз |
| `--index-home <path>` | `CODE_INDEX_HOME` (по умолчанию `<dir>/code-index`) |
| `--buddy-url <url>` | URL сервиса onec-buddy |
| `--latest` | взять последние версии через GitHub API |
| `--pin <id>=<version>` | зафиксировать версию сервера (можно несколько) |
| `--from <id>=<path>` | поставить из локального файла вместо GitHub (напр. свой SNAPSHOT-jar) |
| `--only <id>` / `--skip <id>` | обработать подмножество серверов |
| `--force` | перекачать артефакты заново |
| `--no-config` | только скачать, конфиг не трогать (выведет блок) |
| `--dry-run` | показать план без изменений |
| `--no-backup` | не создавать `.bak` рядом с конфигом |
| `--json` | машинно-читаемый вывод |

## Примеры

```powershell
# только справка по API платформы, из локальной сборки SNAPSHOT
melya-cp-1c install --only bsl-context `
  --from bsl-platform-context="D:\Projects\mcp1c\mcp-bsl-context-0.3.2-SNAPSHOT.jar" `
  --platform-path "C:\Program Files\1cv8\8.3.27.1326"

# посмотреть, что будет записано, без записи
melya-cp-1c print --project "D:\Projects\1с\AITestVS" --json

# обновить всё до последних релизов
melya-cp-1c install --latest --platform-path "C:\Program Files\1cv8\8.3.27.1326"
```

## Как это работает

1. Для каждого сервера определяется релиз: зафиксированная версия из манифеста
   (или последняя при `--latest`) и подходящий под ОС артефакт.
2. Артефакт скачивается в `--dir/<id>/` с проверкой `sha256` (когда GitHub отдаёт digest),
   архивы распаковываются (`tar`, при необходимости `Expand-Archive`/`unzip`).
3. Из существующего `kilo.jsonc` читается блок `mcp`; наши серверы накладываются поверх
   (чужие серверы сохраняются). Запись — точечная, остальной файл и комментарии не меняются,
   рядом создаётся резервная копия `.bak`.
4. Состояние установки пишется в `<dir>/install-state.json`.

## Замечания

- `code-index` требует запущенного демона: `"<dir>\code-index\bsl-indexer.exe" daemon run`
  (он же сам переиндексирует при изменениях файлов).
- `bsl-platform-server` — это BSL Language Server; при необходимости положите рядом
  `.bsl-language-server.json`.
- Пакет не имеет внешних зависимостей: только стандартная библиотека Node.js (>= 18.17).
