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

## Требования

- **Node.js >= 18.17** (проверено на Node 24).
- **Java 17+** — для `bsl-platform-server` и `bsl-platform-context`.
- **Платформа 1С** установлена локально — для `bsl-platform-context` (каталог `--platform-path`).

## Установка

> **Важно.** `npm install melya-cp-1c` только кладёт CLI в `node_modules` и создаёт ярлык
> `node_modules\.bin\melya-cp-1c`. У пакета **нет `postinstall`** — сам он серверы не скачивает
> и `kilo.jsonc` не правит. Чтобы серверы появились, нужно один раз запустить команду `install`
> с обязательными параметрами (примеры ниже).

### Способ 1 — разово через npx (без установки)

```powershell
npx melya-cp-1c@latest install `
  --platform-path "C:\Program Files\1cv8\8.3.27.1326" `
  --project "D:\Projects\1с\AITestVS"
```

### Способ 2 — глобально (команда доступна из любого каталога)

```powershell
npm install -g melya-cp-1c
melya-cp-1c install --platform-path "C:\Program Files\1cv8\8.3.27.1326" --project "D:\Projects\1с\AITestVS"
```

### Способ 3 — локально в проект

```powershell
npm install melya-cp-1c
npx melya-cp-1c install --platform-path "C:\Program Files\1cv8\8.3.27.1326" --project "D:\Projects\1с\AITestVS"
```

Далее в примерах команды показаны без префикса (как при глобальной установке); при локальной
установке добавляйте префикс `npx `.

### Полный вызов

```powershell
melya-cp-1c install `
  --platform-path "C:\Program Files\1cv8\8.3.27.1326" `
  --java "C:\Program Files\Java\jdk-26.0.2.1\bin\java.exe" `
  --project "D:\Projects\1с\AITestVS" `
  --index-home "C:\tools\code-index"
```

- `--platform-path` — каталог платформы 1С (там, где `bin\1cv8.exe`); **обязателен** для `bsl-platform-context`.
- `--java` — путь к `java.exe`; можно не указывать, если Java есть в `PATH` или задан `JAVA_HOME`.
- `--project` — проект 1С для `code-index`; алиас базы берётся из имени каталога (здесь `aitestvs`).
- `--index-home` — каталог `CODE_INDEX_HOME`; необязателен (по умолчанию `<dir>/code-index`).

В PowerShell перенос строки — обратный апостроф `` ` ``, а пути с пробелами — в кавычках.

### Проверка перед установкой

```powershell
melya-cp-1c doctor --platform-path "C:\Program Files\1cv8\8.3.27.1326" --project "D:\Projects\1с\AITestVS"
melya-cp-1c install --dry-run --platform-path "C:\Program Files\1cv8\8.3.27.1326" --project "D:\Projects\1с\AITestVS"
```

### Что произойдёт при `install`

1. Артефакты серверов скачиваются в `--dir` (по умолчанию `C:\Users\<вы>\.melya-cp-1c`).
2. Блок `mcp` в `kilo.jsonc` дополняется нашими серверами; рядом создаётся резервная копия `.bak`.
3. Состояние установки пишется в `<dir>\install-state.json`.

После установки **перезапустите Kilo**, чтобы он перечитал список MCP-серверов.

### Проверка после установки

```powershell
melya-cp-1c list                # статус серверов и пути к артефактам
melya-cp-1c list --json         # то же машинно-читаемо
```

### Типичные проблемы

- **«После `npm install` серверы не установились»** — это ожидаемо: `npm install` только ставит CLI,
  нужен отдельный запуск `install` (см. выше).
- **Java не найдена** — укажите `--java "<путь>\bin\java.exe"` или `--java-home "<каталог JDK>"`.
- **`bsl-platform-context` не запускается** — `--platform-path` должен указывать на каталог платформы
  с `bin\1cv8.exe` (например `C:\Program Files\1cv8\8.3.27.1326`).
- **`code-index` не отвечает** — нужен запущенный демон (см. «Замечания»).
- **Ошибка «Не заданы обязательные параметры»** — не передан `--platform-path` (или не найдена Java).

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

## Разработка и публикация

```powershell
npm test            # тесты (node --test)
npm pack --dry-run  # проверить состав тарбола
npm version patch   # поднять версию перед публикацией
npm publish         # публикация в npm (нужен npm login)
```

Автоматическая публикация — `.github/workflows/publish.yml` (npm Trusted Publishing по OIDC)
при создании GitHub Release. Для неё в настройках пакета на npmjs.com нужно добавить
доверенного издателя: GitHub Actions, репозиторий `08pmmdu1/melya-cp-1c`, workflow `publish.yml`.
Первую публикацию проще сделать локально, затем включить Trusted Publishing.

Репозиторий: <https://github.com/08pmmdu1/melya-cp-1c>.
