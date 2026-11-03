---
'accounts': patch
---

Fixed `Actions.funding.open` in `popup` mode, whose waiting dialog threw `Cannot set property closed of #<Window>` as it closed.
