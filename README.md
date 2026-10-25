# extension-watch

Watch installed browser extensions for updates and permission changes, and notify.

## What it does

A Manifest V3 extension that sends a message to an [ntfy](https://ntfy.sh) topic when another extension:

- is installed (with its permissions and host permissions)
- changes version
- gains or loses permissions or host permissions
- changes install type
- gets disabled, including when Chrome disables it until a permission increase is accepted

It compares `chrome.management.getAll()` against the last snapshot in `chrome.storage.local` on Chrome startup and on every `management` event, so updates that happened while it was not running are still reported. The first run only records a baseline.

If sending fails (no URL, network error, non-2xx), the snapshot is kept so the same changes are sent on the next check, the badge shows `!`, and the error is shown on the options page.

Permissions: `management` and `storage` only. The message is sent as a CORS simple request (plain-text POST, title in the query string), which ntfy accepts without host permissions.

## Install

1. Open `chrome://extensions`, turn on Developer mode, and click "Load unpacked". Select the `extension/` directory.
2. Open the extension's options and enter the ntfy topic URL (for example `https://ntfy.example.com/extension-watch`).

## Test

```bash
bun install
bunx playwright install chromium
bun test
```

`tests/e2e.test.ts` loads the extension and a target extension into Chrome for Testing, starts a fake ntfy on `127.0.0.1`, bumps the target's version with a new permission, reloads it, and checks the message.
