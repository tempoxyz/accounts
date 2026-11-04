# Actions.redirect.prefetch

## Overview

Prefetches the scripts and style sheets of Tempo ID's sign-in page, from `GET /v1/auth/assets`. The page that [`Actions.redirect.start`](Actions.redirect.start.md) opens then loads them from the browser's cache, and takes input sooner. The call needs no session, and sends no cookie.

A browser partitions its cache by site. Only a page on Tempo ID's site gains, such as `app.tempo.xyz` for `id.tempo.xyz`. A page on another site downloads the assets again at the redirect. Call it once the sign-in button shows, so the prefetch ends before the click.

## Usage

```ts
import { Actions } from 'accounts/internal'

// Once the sign-in button shows:
void Actions.redirect.prefetch(config)
```

## Return type

`readonly string[]`

The absolute URLs of the sign-in page's scripts and style sheets. Outside a browser, the call returns them and prefetches nothing.

## Errors

The action throws nothing. A failed read returns no URLs and prefetches nothing, and the sign-in page loads its assets itself.
