---
'accounts': patch
---

Changed the `viem` plugin to keep its marks of registered access keys in the `store` of `backend({ store })` when the instance has no `store`. Before, the first transaction of a session in each new instance, such as each request of a Worker or each replica, attached the key authorization again, and the node refused it. That transaction sent 8 requests in place of 2.
