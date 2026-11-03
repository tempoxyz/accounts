---
'accounts': minor
---

Added `mode: 'frame'` to `Actions.funding.open` and the `funding` plugin. It opens Tempo ID's deposit page in a frame in a dialog on the app's page, for an enabled first-party web app. iOS and iPadOS open a popup instead. A frame that shows no deposit page offers a popup from the user's click.

`frame` is the new default. An app that is not an enabled first-party web app on Tempo ID's site, such as a third-party app with a registered client ID, shows **Continue** in the dialog before the popup. Pass `mode: 'popup'` to open the popup at once.
