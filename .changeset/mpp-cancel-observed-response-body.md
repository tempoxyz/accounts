---
'accounts': patch
---

Fixed `accounts.fetch` and `accounts.mpp(…).fetch` of the `mpp` plugin, which kept an unread copy of each paid response's body. The copy buffered every chunk that the app read, and a cancellation of the body never reached the endpoint, so a paid stream stayed open. The plugin now cancels its copy at once.
