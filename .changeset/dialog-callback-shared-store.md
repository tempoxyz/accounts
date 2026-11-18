---
'accounts': patch
---

Fixed `dialog.callback` for an instance whose `store` holds its values in one window, such as `Store.memory`. The sign-in's item, which the popup's callback page reads, stays in IndexedDB, which every window of the origin shares. The item stays in the instance's store too, and the callback page reads both, so a callback page of an earlier release, or IndexedDB that refuses the item, fails no sign-in. Before, the callback page read its own empty store, so on a page that sends `Cross-Origin-Opener-Policy: same-origin` the popup stayed open, and `dialog.signIn` never settled.
