---
'accounts': patch
---

In a browser without IntersectionObserver v2, such as Safari or Firefox, `funding.open` opens the deposit page in a popup at once, within the click, for an app that the dialog's preloaded frame reported as not trusted, as the approval pages do. `funding.preload` loads no frame for such an app.
