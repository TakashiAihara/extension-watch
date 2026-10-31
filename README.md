# extension-watch

Watch installed Chrome extensions for updates and permission changes, and notify [ntfy](https://ntfy.sh).

Nothing is installed in Chrome. A small CLI reads the extension records Chrome keeps in each profile, compares them with the previous run, and sends one message per changed extension. Run it every few minutes with the OS scheduler.

## What it reports

For every extension in every profile (Chrome's built-in extensions are skipped):

- installed (with its permissions, hosts, and content script sites)
- version changed
- permissions, hosts, or content script sites added or removed
- install location changed
- disabled, with Chrome's numeric disable reasons

Removed extensions are dropped from the record without a message. The first run only records a baseline.

## Where it reads

| OS | Chrome user data | Extension records |
|---|---|---|
| Windows | `%LOCALAPPDATA%\Google\Chrome\User Data` | `<profile>\Secure Preferences` |
| macOS | `~/Library/Application Support/Google/Chrome` | `<profile>/Preferences` or `Secure Preferences` |
| Linux | `~/.config/google-chrome` | `<profile>/Preferences` |

Content script sites come from `active_permissions.scriptable_host`, which the `chrome.management` API does not expose.

## Configuration

`config.json`:

| OS | Path |
|---|---|
| Windows | `%APPDATA%\extension-watch\config.json` |
| macOS / Linux | `$XDG_CONFIG_HOME/extension-watch/config.json` (default `~/.config/...`) |

```json
{
  "ntfyUrl": "https://ntfy.example.com/extension-watch",
  "ntfyToken": "tk_...",
  "chromeUserDataDir": "C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\User Data"
}
```

- `ntfyUrl` is required. `ntfyToken` is sent as `Authorization: Bearer`. `chromeUserDataDir` defaults to the path in the table above
- The previous snapshot is kept in `%LOCALAPPDATA%\extension-watch\state.json` (Windows) or `$XDG_STATE_HOME/extension-watch/state.json` (default `~/.local/state/...`)

## Failures

- A message that cannot be sent (network error, timeout after 10 s, non-2xx) keeps that extension's old record, so the same change is sent on the next run. Exit code 1
- Chrome data or the state file that cannot be read is sent to ntfy as an error. Exit code 1
- A missing or invalid `config.json` cannot be sent anywhere. It is printed to stderr and the run exits with 1, which Task Scheduler shows as the last run result
- Messages over 4080 bytes are sent in parts prefixed `(1/2) `

## Install on Windows

```bash
bun install
bun run build:windows
```

Copy `dist/extension-watch.exe` to `%LOCALAPPDATA%\Programs\extension-watch\`, write `config.json`, then register it in PowerShell:

```powershell
$exe = "$env:LOCALAPPDATA\Programs\extension-watch\extension-watch.exe"
schtasks /Create /TN extension-watch /SC MINUTE /MO 5 /TR "`"$exe`"" /F
schtasks /Run /TN extension-watch
```

Stop it with `schtasks /Delete /TN extension-watch /F`.

## Test

```bash
bun install
bunx playwright install chromium
bun test
```

`tests/e2e.test.ts` loads an unpacked extension into Chrome for Testing, closes Chrome, runs the watcher on that profile, updates the extension (new permission and an all-sites content script), and checks the message a fake ntfy received.

## Not verified

- Whether an update that Chrome disables for a permission increase still lists the old permissions in `active_permissions`
- Reading `Secure Preferences` while Chrome is writing it
- macOS
