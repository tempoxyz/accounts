---
"accounts": patch
---

Fixed relay handler gas bump not applying when `feePayer` is present. The condition checked `result.tx.feePayer` (node response) which is not set; now checks `request.feePayer` (the input).
