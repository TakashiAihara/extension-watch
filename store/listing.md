# Chrome Web Store listing

The text entered in the developer dashboard, kept here so it changes together with the extension. The item name and summary come from `name` and `description` in `extension/manifest.json`.

Screenshots (1280x800) are rendered with sample data by `bun scripts/store-screenshots.ts store` (after `bun install` and `bunx playwright install chromium`).

## Description

```text
Know when another extension changes, so a silent update that adds permissions does not go unnoticed.

It sends a message to your own ntfy topic when an extension:
- is installed (with its permissions, host permissions and permission warnings)
- changes version
- gains or loses permissions, host permissions or permission warnings
- changes install type
- is disabled (with Chrome's reason, such as permissions_increase) or enabled again

It checks on browser start, on every extension event, and every 5 minutes, so changes made while it was not running are still reported. A failed send is retried on the next check, and every change is kept in a local history on the options page.

Setup: open the options page, enter your ntfy topic URL (for example https://ntfy.example.com/extension-watch) and an access token if your server needs one, then allow access to that origin. Administrators can push the URL and token by policy instead.

Enforced by Chrome:
- No site is reachable at install time. The only host permission is the ntfy origin you enter, requested when you save it
- No content script: it never sees the pages you visit

Checked by tests in the repository:
- An access token is never sent over plain http, except to loopback
- A URL set by policy brings its own token; the token typed on the options page is never sent to it
- Each change is sent once, and a failed send is retried with the same change instead of being lost

Nothing is sent anywhere except the ntfy URL you set. No analytics, no telemetry, no developer server.

No dependencies: about 440 lines of plain JavaScript you can read yourself. Releases are reproducible from their tag and carry a build provenance attestation.

Open source (MIT): https://github.com/TakashiAihara/extension-watch
Report a problem: https://github.com/TakashiAihara/extension-watch/issues
```

## Links

The dashboard's Store listing tab asks for these separately.

- Homepage URL: `https://github.com/TakashiAihara/extension-watch`
- Support URL: `https://github.com/TakashiAihara/extension-watch/issues`

## Category

Developer Tools (the same as Secure Cookie Viewer)

## Single purpose

```text
Watch the other installed extensions and send a notification to the user's own ntfy server when one is installed, updated, changes permissions, or is disabled or enabled.
```

## Permission justification

### management

```text
Reads the list of installed extensions (version, permissions, host permissions, permission warnings, enabled state) to detect changes. This is the extension's single purpose.
```

### storage

```text
Keeps the last snapshot of the extension list, the change history, and the ntfy URL and token entered on the options page, in chrome.storage.local on the device.
```

### alarms

```text
Runs a check every 5 minutes, because permissions granted at run time fire no management event.
```

### Host permission (optional_host_permissions: https://*/*, http://*/*)

```text
Requested at run time for the one ntfy origin the user enters, so the extension can send the notification there. No other site is requested or accessed.
```

## Remote code

No remote code is used.

## Data usage

Declare "Authentication information": the ntfy access token the user enters is stored in `chrome.storage.local` and sent with every notification, as an `Authorization` header (or `?auth=` when set by policy), to the ntfy server the user configures. The list of installed extensions, the only other data sent and only to that server, fits none of the dashboard's categories. The developer runs no server and receives nothing. All three certifications (no sale, no unrelated use, no creditworthiness use) apply.

## Privacy policy

```text
https://github.com/TakashiAihara/extension-watch/blob/main/PRIVACY.md
```
