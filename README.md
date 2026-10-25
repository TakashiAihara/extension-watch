# extension-watch

Watch installed browser extensions for updates and permission changes, and notify.

## What it does

A Manifest V3 extension that sends a message to an [ntfy](https://ntfy.sh) topic when another extension:

- is installed (with its permissions, host permissions, and permission warnings)
- changes version
- gains or loses permissions, host permissions, or permission warnings
- changes install type
- gets disabled, with Chrome's reason (`permissions_increase` when Chrome holds an update until new permissions are accepted)

Permission warnings (`management.getPermissionWarningsById`) are compared because `hostPermissions` does not include content-script matches: an update that adds a content script on all sites shows up only as a new warning.

It compares `chrome.management.getAll()` against the last snapshot in `chrome.storage.local` on Chrome startup, on every `management` event, and every 5 minutes (for permissions granted at runtime, which fire no `management` event). Updates that happened while it was not running are still reported. The first run only records a baseline.

Each changed extension is sent as its own message. If a send fails (no URL, network error, non-2xx), that extension keeps its old record so the same change is sent on the next check, the badge shows `!`, and the error is shown on the options page.

Permissions: `management`, `storage`, `alarms`, and an optional host permission for the ntfy origin, requested when the URL is saved.

## Install

1. Open `chrome://extensions`, turn on Developer mode, and click "Load unpacked". Select the `extension/` directory.
2. Open the extension's options, enter the ntfy topic URL (for example `https://ntfy.example.com/extension-watch`), save, and allow access to that origin.

## Test

```bash
bun install
bunx playwright install chromium
bun test
```

`tests/e2e.test.ts` loads the extension and a target extension into Chrome for Testing, starts a fake ntfy on `127.0.0.1`, and checks that:

- a version bump that adds a permission and an all-sites content script is sent once
- a rejected send (HTTP 500) is sent again on the next check
- disabling the target is sent

## Not verified

- The event order and the reported permissions for a store auto-update, and for an update Chrome disables with `permissions_increase` (the added permissions may only appear once the update is accepted)
- Behaviour against a real ntfy server and with the host permission granted (the test cannot grant it without a user gesture, so the fake server sends `Access-Control-Allow-Origin: *`)
