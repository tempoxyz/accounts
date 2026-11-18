---
'accounts': patch
---

Fixed overlapping `session.get` calls with `reauthorize: true`. Overlapping calls share one call, so a page that restores from two places, such as a router loader and an effect, sends one `GET /v1/auth/session` and one `POST /v1/authorize`, and each call returns the same session. Before, each call authorized on its own, so the page sent each request twice and authorized two access keys. A call with an object or a function for `reauthorize` still runs its own authorization.
