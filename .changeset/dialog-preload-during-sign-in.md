---
'accounts': patch
---

`Actions.dialog.preload`, and the `dialog` plugin's preload at a session restore or a sign-out, load no frame while a sign-in holds the dialog. The sign-in keeps its own frame for the next one, and the preload loads only if it kept none. A sign-in that starts while the page restores its session, such as at the mount of `react`, loads Tempo ID's `/embed` page once instead of twice.
