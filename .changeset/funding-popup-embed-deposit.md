---
'accounts': patch
---

Changed `Actions.funding.open` in `popup` mode, and the popup that a frame opens for Buy MACH, to open `/embed/deposit?display=popup` in place of `/deposit?display=popup`. `redirect` mode still opens `/deposit`.
