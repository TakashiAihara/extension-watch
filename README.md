# extension-watch

Watch installed browser extensions for updates and permission changes, and notify.

## What it does

A Manifest V3 extension that sends a message to an [ntfy](https://ntfy.sh) topic when another extension:

- is installed (with its permissions, host permissions, and permission warnings)
- changes version
- gains or loses permissions, host permissions, or permission warnings
- changes install type
- gets disabled, with Chrome's reason (`permissions_increase` when Chrome holds an update until new permissions are accepted)
- is enabled again (`enabled (was permissions_increase)` when Chrome had held it for new permissions, which is when they start to apply)

Permission warnings (`management.getPermissionWarningsById`) are compared because `hostPermissions` does not include content-script matches: an update that adds a content script on all sites shows up only as a new warning.

It compares `chrome.management.getAll()` against the last snapshot in `chrome.storage.local` on Chrome startup, on every `management` event, and every 5 minutes (for permissions granted at runtime, which fire no `management` event). Updates that happened while it was not running are still reported. The first run only records a baseline.

Each changed extension is sent as its own message. If a send fails (no URL, network error, non-2xx), that extension keeps its old record so the same change is sent on the next check, the badge shows `!`, and the error is shown on the options page.

Permissions: `management`, `storage`, `alarms`, and an optional host permission for the ntfy origin, requested when the URL is saved.

## Install

1. Open `chrome://extensions`, turn on Developer mode, and click "Load unpacked". Select the `extension/` directory.
2. Open the extension's options, enter the ntfy topic URL (for example `https://ntfy.example.com/extension-watch`) and, if the server requires authentication, an access token (sent as `Authorization: Bearer`). Credentials, in the token field or as `?auth=` / `?authorization=` in the URL, need an https URL; only loopback may use http. Save and allow access to that origin.

## Deploy to an organization

An administrator can install the extension on every managed browser and push the ntfy settings, so nobody has to open the options page.

### Install

Force-install it with the `ExtensionInstallForcelist` policy. A force-installed extension cannot be disabled or removed by the user.

Where the extension can come from depends on how the browsers are managed (the policy description in Chromium's `ExtensionInstallForcelist.yaml`):

- On Windows joined to Active Directory or Entra ID, on macOS managed by MDM or joined via MCX, and on any browser enrolled in Chrome Enterprise Core, a self-hosted CRX with its own update URL can be force-installed
- Elsewhere, it has to come from the Chrome Web Store (an unlisted listing is enough)

### Settings

The extension declares a policy schema (`extension/schema.json`), so the ntfy settings can be pushed as extension policy (managed storage):

| Key | Value |
|---|---|
| `ntfyUrl` | The ntfy topic URL. When set, it replaces the URL on the options page, which then shows it read-only |
| `ntfyToken` | The access token for that URL. It is used only together with `ntfyUrl` from the same policy, never with a token typed on the options page |

Where the values go:

- Windows: string values under `HKEY_LOCAL_MACHINE\Software\Policies\Google\Chrome\3rdparty\extensions\<extension id>\policy`
- macOS: a configuration profile for the preference domain `com.google.Chrome.extensions.<extension id>`
- Chrome Enterprise Core: the extension's policy JSON in the Admin console

Notes:

- The same credential rules apply as on the options page: https only (except loopback), no `user:pass@`
- Use a token that can only write to this topic. `ntfyToken` is marked `sensitiveValue` in the schema
- A policy URL gets no host permission, so sending relies on the server's CORS headers. Measured with Chromium 156: an extension without host permission sent a POST with an `Authorization` header to ntfy (which answers the preflight with `access-control-allow-origin: *` and `access-control-allow-headers: *`) and got ntfy's own 401 for a wrong token, so the header reached the server. A proxy in front of ntfy that drops those headers would break sending
- Every browser posts to the same topic, and a message does not say which browser it came from yet (issue #9)

This extension's role next to Chrome Enterprise Core: it sends a push notification the moment an extension is updated, changes permissions, or is disabled or enabled, with the permissions that were added or removed.

## Test

```bash
bun install
bunx playwright install chromium
bun test
```

`tests/e2e.test.ts` loads the extension and a target extension into Chrome for Testing, starts a fake ntfy on `127.0.0.1`, and checks that:

- a version bump that adds a permission and an all-sites content script is sent once
- a rejected send (HTTP 500) is sent again on the next check
- a change rejected for a missing token (HTTP 403) is sent once a token is saved, as `Authorization: Bearer`
- a stored token is not sent over http to a host other than loopback
- the options page refuses `user:pass@`, non-http(s) URLs, tokens with spaces, and a token over http (saving itself waits on Chrome's permission prompt, so it is checked by hand)
- disabling the target is sent, and so is enabling it again

`tests/rules.test.ts` covers the URL and token checks the options page and the sender share.

## Not verified

- The event order and the reported permissions for a store auto-update, and for an update Chrome disables with `permissions_increase` (the added permissions may only appear once the update is accepted)
- Settings pushed by a real policy: the tests replace `chrome.storage.managed.get` instead, because pushing a policy needs the system policy directory

