---
'accounts': patch
---

Fixed `relay` sending the app's API key through a redirect of `apiUrl` in the Tempo API mode. The route now follows no redirect, and returns 503 with the reason `temporarily_unavailable`.
