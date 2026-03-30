---
"accounts": patch
---

Fixed iframe dialog being silently removed by React 19 hydration in Next.js App Router. A `MutationObserver` now detects removal and re-appends the dialog with a fresh messenger bridge.
