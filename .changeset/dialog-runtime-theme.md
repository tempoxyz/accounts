---
'accounts': minor
---

Added runtime theme sync for iframe dialog. Theme changes (accent, radius, font) now propagate to the cached iframe without reloading via the `syncTheme` method and a new `theme` messenger topic.
