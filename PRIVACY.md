# Privacy policy

This extension watches the other extensions installed in your browser and sends a message about each change to an ntfy server that you (or your administrator, through policy) configure.

## What it reads

- The list of installed extensions from `chrome.management`: name, ID, version, install type, whether it is enabled and why it was disabled, its permissions and host permissions, and the permission warnings Chrome shows for it.
- Its own settings: the ntfy URL and access token from the options page or from policy (`chrome.storage.managed`), and the browser's UI language (the permission warnings are read in that language).
- It does not read web pages, browsing history, cookies, form data, or any other browsing data.

## Where data goes

- A message for each changed extension (its name, ID, and what changed) is sent to the ntfy URL set on the options page or by policy, with the access token set there. Nothing is sent until a URL is set.
- Nothing is sent anywhere else. There is no analytics, no telemetry, and no server run by the developer; the developer receives no data.

## What it stores

- In `chrome.storage.local`, in your browser profile only: the last snapshot of the extension list (and the browser language its permission warnings were read in), the history of changes (the newest 500 entries, about 1 MB; a change still waiting to be sent is kept past that limit until it is sent or superseded), the last send error, and the ntfy URL and access token entered on the options page.
- Removing the extension deletes this data.
