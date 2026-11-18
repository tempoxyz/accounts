---
'accounts': patch
---

Fixed the `expo` preset sending the same refresh token twice. Each `expo()` call created its own lock, so two instances on one `url`, `clientId`, and chain, such as a config that two modules create, or that Fast Refresh runs again while the old instance lives, refreshed their shared session at once from the device's secure store. Tempo ID refuses the second refresh as a reuse. Every preset now shares one lock, so the second instance reads the first one's refreshed session and sends no request.
