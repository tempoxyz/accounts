---
'accounts': minor
---

Generalized remote theme handling: switched to `data-theme-radius`, `data-theme-accent`, and `--theme-accent` hooks, included `scheme` in live theme messages, and let the consuming app own preset-to-UI mapping. The `font` URL param and `--font-body` injection were removed — consumers now own font loading.

```diff
- [data-accent='blue'] { … }
+ [data-theme-accent='blue'] { … }

- [data-radius='medium'] { … }
+ [data-theme-radius='medium'] { … }

- :root { background: var(--accent-base); }
+ :root { background: var(--theme-accent); }

- // ?accent=…&radius=…&font=…&scheme=…
+ // ?accent=…&radius=…&scheme=…
```
