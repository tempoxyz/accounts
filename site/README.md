# Site

The documentation site of `accounts`, a [Vocs](https://vocs.dev) project. The build is static, and Cloudflare serves its files. A [Worker](#server) serves the routes of the demos.

Run from the repository root:

```sh
pnpm install
pnpm --dir site dev
```

`pnpm --dir site dev` prints the URL of the site.

```sh
pnpm --dir site check:types
pnpm --dir site build
pnpm --dir site preview
```

`pnpm --dir site preview` serves the files of the last build and the Worker with Wrangler, as the deployment does. It reloads the Worker after each change of `src/server/`. A change of a page needs a new build.

The scripts run Vite, which reads `vite.config.ts`. The demos import `viem/tempo`, whose Node-only branch loads `node:worker_threads`. The static build bundles every import of the browser bundle, so the config resolves that built-in to an empty module there.

Through a proxy that names another host, the dev server responds with an error. Serve the build with `pnpm --dir site preview` there.

## Deployment

`.github/workflows/site.yml` deploys the Worker `accounts-site` to the production Cloudflare account. No job holds a long-lived Cloudflare token.

| Event           | Deployment                                                                |
| --------------- | ------------------------------------------------------------------------- |
| Push to `main`  | The Worker, at its custom domain `accounts.tempo.xyz`, through the broker |
| Pull request    | A build of the site and a bundle of the Worker, which deploy nothing      |
| Manual dispatch | The Worker, from `main` only, as a push deploys it                        |

A push to `main` deploys through the [Cloudflare Deploy Broker](https://github.com/tempoxyz/cloudflare-deploy-broker), so no job of the push holds a Cloudflare token. The `attest` job runs the broker's trusted build workflow, which runs `pnpm build`, bundles the Worker, and attests the Worker, `wrangler.json`, and the files of `dist/public`. The `deploy` job sends them to the broker as the deployment `accounts-site`. The broker uploads and promotes the version, checks Cloudflare's readback, and keeps the Worker's secrets. The job then requests `accounts.tempo.xyz`.

The `accounts` entry of [`tempoxyz/cloudflare-deploy-policies`](https://github.com/tempoxyz/cloudflare-deploy-policies) authorizes the first broker deployment, and the broker then keeps the grant for this repository, the deployment, and the Worker. A change of the code, a variable, or the files needs no other change. A new binding, a route, or a change of the KV namespace, the account, or the name of the Worker needs a new policy entry. The broker requires `account_id`, the `ASSETS` binding of the assets, and the `CF_VERSION_METADATA` binding. The Worker reads neither binding. `STORE` names the ID of the namespace that Wrangler created, since a binding without an ID asks the broker for a new namespace. The Workers tab of the broker's dashboard, `https://cf.tehq.net/`, changes the Worker's secrets.

A pull request's `build` job builds the site and bundles the Worker without secrets. It deploys nothing, so a pull request of the site gets no preview. The Worker implements a Durable Object, and Cloudflare gives such a Worker no preview URL.

Only `main` deploys the Worker. No command deploys it from a checkout.

`wrangler.json` names `dist/public` as the assets of the Worker, and `src/server/Worker.ts` as its script.

`DURABLE_STORE` binds the `DurableStore` Durable Object of `src/server/Store.ts`, one object for each key, for the values that a demo takes once, such as a challenge. Workers KV has no atomic read and delete. `exports` of `wrangler.json` declares the class with SQLite storage, since the broker refuses `migrations`.

`routes` of `wrangler.json` names `accounts.tempo.xyz` as the custom domain of the Worker. The broker verifies the domain on each deploy. It attaches the domain only to a hostname that holds no other DNS record. `public/_headers` sets `Strict-Transport-Security` on the domain, since the `tempo.xyz` zone sets none.

`renderStrategy: 'full-static'` in `vocs.config.ts` writes each page as a file. A static build has no server for the redirects of `vocs.config.ts`, from `/docs` and the former path of "Getting started" to `/`, so `public/_redirects` repeats them for Cloudflare. It also serves the Markdown of a page at the page's path with `.md`.

## Sidebar

`sidebar` in `vocs.config.ts` orders the sidebar. A topic with one page comes from `item`, which names the page, its label, and its icon. A topic with more guides comes from `topic`, which names its [overview](#overviews) and each guide, and starts collapsed:

```ts
item({ icon: 'wagmi', link: '/docs/guides/wagmi', text: 'Wagmi' })

topic({
  guides: [
    {
      link: '/docs/guides/access-keys/revoke-access-keys',
      text: 'Revoke access keys',
    },
  ],
  icon: 'key',
  link: '/docs/guides/access-keys',
  text: 'Access keys',
})
```

| Option   | Value                                                                                   |
| -------- | --------------------------------------------------------------------------------------- |
| `guides` | Guides of the topic, each with its `link` and its `text`                                |
| `icon`   | Name of an SVG file of `icons/`, which draws with `currentColor`                        |
| `link`   | Path of the page. Of a `topic`, optional, the path of its overview, the item "Overview" |
| `text`   | Label of the item                                                                       |

Most icons come from Tempo's design system, `@tempoxyz/ds`. `puzzle` comes from [Lucide](https://lucide.dev/icons/puzzle), since the design system holds no such icon. The topic of a brand shows the brand's official mark in one color, so that it follows the text color as each other icon does:

| Icon    | Source                                                                                                     |
| ------- | ---------------------------------------------------------------------------------------------------------- |
| `mcp`   | `docs/favicon.svg` of [modelcontextprotocol](https://github.com/modelcontextprotocol/modelcontextprotocol) |
| `mpp`   | The avatar of [MPP's brand assets](https://mpp.dev/brand)                                                  |
| `react` | `src/components/Logo.tsx` of [react.dev](https://github.com/reactjs/react.dev)                             |
| `viem`  | The "V" of `.github/gh-logo-light.svg` of [viem](https://github.com/wevm/viem)                             |
| `wagmi` | `site/public/favicon.svg` of [wagmi](https://github.com/wevm/wagmi)                                        |

An item is disabled until the MDX file of its `link` exists. Vocs' pagination links each item that holds a `link`, so a disabled item holds none.

| Item  | Label                                                               | Example              |
| ----- | ------------------------------------------------------------------- | -------------------- |
| Topic | A noun phrase                                                       | "Access keys"        |
| Guide | Starts with a verb, ends with a noun, and holds at most three words | "Revoke access keys" |

A topic with more guides is a group of the sidebar, and each of its guides is an item of the group, the page `src/pages/docs/guides/<topic>/<guide>.mdx`. In "Tasks after sign-in", the first item of a group is "Overview", the page `src/pages/docs/guides/<topic>.mdx`. A topic without a `link` holds no "Overview" item. A click on the label of a group only opens or closes it. Vocs expands a group only for the page of an item, so the overview is an item, not the `link` of the group. Each topic of "Sign-in flows" is one page, and a variant of its flow is a use case of the page.

Vocs renders the icon of an item only in its badge, after the text. `src/pages/_root.css` moves the icon before the text, and removes the style of the badge.

## Pages

A page is an MDX file of `src/pages/`, and its path is its URL. `src/pages/index.mdx` is the page of `/`, "Getting started". It also holds the `Forward` of the "Redirect" demo, since the root is the demo's redirect URI.

Each page starts with a `#` title, with its description in brackets:

```mdx
# Sessions [A session holds the tokens and the access key of a signed-in user.]

## Overview
```

| Element    | Syntax                                                                         |
| ---------- | ------------------------------------------------------------------------------ |
| Callout    | `:::warning`, `:::note`, or `:::tip`, closed with `:::`                        |
| Card       | `<Cards>` from `vocs`, with one [`<PageCard>` or `<ExampleCard>`](#cards) each |
| Code title | ` ```tsx [App.tsx] `                                                           |
| Code tabs  | `:::code-group`, with one titled fence for each tab                            |
| Highlight  | `// [!code hl]` on a line, or `// [!code hl:start]` and `// [!code hl:end]`    |
| Demo       | [`<Demo name source title />`](#demos)                                         |
| Diagram    | A `mermaid` fence                                                              |
| Prompt     | `:::prompt`, which shows its text collapsed, with a copy control               |
| Rows       | [`<CardRows>`](#cards), with one `<PageCard>` or `<ExampleCard>` each          |
| Source     | [`<SourceLink name path>`](#source-links), around the name of an export        |
| Steps      | `::::steps`, with one `###` heading for each step                              |
| Step tag   | [`<StepTag kind>`](#step-tags), at the end of the heading of a step            |
| Tabs       | `<Tabs stateKey>` and `<Tab title>` from `vocs`, with a blank line around each |

[Vocs' docs](https://vocs.dev/docs) describe each element of Vocs.

A page of `src/pages/docs/introduction/` is a plain page: its sections follow its topic. "Getting started", in `src/pages/index.mdx`, holds each element of the table but a diagram. At its first use, a guide links a term to the overview of its topic, such as an access key to `/docs/guides/access-keys`. A term without an overview links to the guide that covers it.

| Callout      | Use                                                                     |
| ------------ | ----------------------------------------------------------------------- |
| `:::warning` | A security caveat                                                       |
| `:::note`    | An environment pitfall                                                  |
| `:::tip`     | An option of a step, such as `funding` of a sign-in, in place of a step |

## Guides

A guide page holds one guide. Its sections are:

| Section     | Content                                                                     |
| ----------- | --------------------------------------------------------------------------- |
| Overview    | What the guide builds, then a [demo](#demos) that runs it end to end        |
| Walkthrough | The example of `examples/` that runs the flow, then the steps that build it |
| Use cases   | Each option of the guide's API that an app uses, with a short example       |
| Next steps  | [Cards](#cards) of the pages that follow                                    |

````mdx
import { Cards } from 'vocs'
import { Demo } from '../../components/Demo.tsx'
import { PageCard } from '../../components/PageCard.tsx'

# Revoke access keys [An app revokes the access key of a session.]

## Overview

The demo signs a user in, and revokes the access key of the session.

<Demo
  name="RevokeAccessKeys"
  source="examples/web"
  title="Revoke an access key"
/>

## Walkthrough

The [`web`](https://github.com/tempoxyz/accounts/tree/main/examples/web) example runs these steps.

::::steps

### Install the packages

### Create the instance

```ts [main.ts]
const accounts = Accounts.create({ chain: 'testnet' })
```

::::

## Next steps

<Cards>
  <PageCard
    description="Sign a user in, and send a payment."
    icon="lightning"
    title="Getting started"
    to="/"
  />
</Cards>
````

A walkthrough holds only the steps that the flow needs. A task that is the same on each platform, such as a sign-out, is a `###` use case below the walkthrough. Each web snippet is a React component, such as in `App.tsx`. As in "Getting started", it imports the instance from `tempo.config.ts`, and a code group shows both files. A snippet that renders a session adds the `react` plugin of `accounts/react`, and reads `accounts.useSession()`.

Each server snippet runs on any JavaScript server. It is a Fetch handler, such as a Hono app in `server.ts`. It reads a secret from `process.env`, and keeps state in a `Store`, such as `Store.memory()`. If no instance runs in the browser, `server.ts` imports the server's instance from `tempo.config.ts`. Otherwise `tempo.config.ts` holds the browser's instance, and each `server.ts` snippet creates the server's instance itself, as the "Sign in with the dialog" use case of "Backend" does. No page names a hosting platform or its APIs, such as a binding or a configuration file, also where the example of the flow runs on one. Two exceptions name the entry `accounts/cloudflare`: a table that lists each store of the package, and "Migration from v0", where it replaces an API of version 0.

Each step of a walkthrough matches the example and the current `src/`. Each snippet is a complete file. To check a snippet, copy each file of its code group into the folder of the example, and run `pnpm check:types`.

### Overviews

In "Tasks after sign-in", the overview of a topic with more guides states what the topic is for and when an app uses it, then shows each guide as a [card](#cards). It holds no demo and no steps. A topic with one page, such as "Wagmi", needs no overview page, since the Overview section of the page takes its place.

| Section  | Content                                                                    |
| -------- | -------------------------------------------------------------------------- |
| Overview | What the topic is for, and when an app uses it, in two or three paragraphs |
| Guides   | A `PageCard` for each guide, in the order of the sidebar                   |

```mdx
import { Cards } from 'vocs'
import { PageCard } from '../../../components/PageCard.tsx'

# Access keys [An access key signs for the user's Tempo Account within limits that the user approves.]

## Overview

An access key signs transactions for the user's Tempo Account with no wallet prompt.

## Guides

<Cards>
  <PageCard
    description="Change the limits of an access key, or revoke it."
    icon="key"
    title="Revoke access keys"
    to="/docs/guides/access-keys/revoke-access-keys"
  />
</Cards>
```

### Use cases

"Use cases" covers the guide's main API, such as `dialog.signIn` and the options of the `dialog` plugin. Each option that an app uses is one `###` use case, named for what it does, such as "Cancel a sign-in". A use case holds one or two sentences, a `SourceLink` to the option, and a short snippet, which is a complete file. The list follows the options and their TSDoc in `src/`, and skips internal options.

### Stores

A walkthrough keeps server state in `Store.memory()`, so the reader installs no database. One `:::note` on the page names a shared store for production, such as `Store.postgres` or `Store.redis`.

### Step tags

If a walkthrough mixes server and client steps, `StepTag` of `src/components/StepTag.tsx` shows "Server" or "Client" after the heading of each step. No space goes before it, so the anchor of the heading ends with its text. The outline drops the tag.

```mdx
### Serve the sign-in routes<StepTag kind="server" />
```

### Tabs

If the steps differ by platform, one tab holds the steps of each platform. Each tab holds its own steps block. `stateKey` names the query parameter of the open tab, so `?platform=cli` opens the CLI tab.

```mdx
<Tabs stateKey="platform">
<Tab title="Web">

::::steps

### Install the packages

::::

</Tab>
<Tab title="CLI">

::::steps

### Install the packages

::::

</Tab>
</Tabs>
```

The outline of a page lists only the steps of the open tab.

### Code changes

A step shows a change to earlier code with `// [!code ++]` and `// [!code --]`. On a line between JSX tags, the notation is text unless it is a JSX comment:

```tsx
return (
  <main>
    {' '}
    {/* [!code ++] */}
    <p>Signed in as {session.user.email}</p> {/* [!code ++] */}
  </main> // [!code ++]
)
```

### Highlights

Most snippets highlight the lines that a step is about, and only those. `// [!code hl]` highlights its own line. A block between `// [!code hl:start]` and `// [!code hl:end]` lines is highlighted, and the marker lines do not show. Put the markers at the level of statements, since a `//` comment between JSX tags is text.

```tsx
// [!code hl:start]
if (!session)
  return <button onClick={() => accounts.dialog.signIn()}>Sign in</button>
// [!code hl:end]
```

### Cards

A list of pages or examples is a list of cards in Vocs' `Cards`, not a table. `CardRows` of `src/components/CardRows.tsx` shows the same cards as thin rows, one card for each row, such as the overview of "Getting started".

`PageCard` of `src/components/PageCard.tsx` links a page of the site. A card is disabled until `src/pages/` holds the page of its `to`, as the item of the sidebar is. A page thus names the pages that follow it before they exist, with no dead link.

| Property      | Value                               |
| ------------- | ----------------------------------- |
| `description` | One sentence on what the page holds |
| `icon`        | Name of an SVG file of `icons/`     |
| `title`       | Title of the page                   |
| `to`          | Path of the page                    |

`ExampleCard` of `src/components/ExampleCard.tsx` links an example of `examples/` in the repository, in a new tab. Its description is plain text.

```mdx
<Cards>
  <ExampleCard
    description="Sign-in through a dialog on the page."
    icon="browser-window"
    name="web"
    title="Web"
  />
</Cards>
```

| Property      | Value                                 |
| ------------- | ------------------------------------- |
| `description` | One sentence on what the example runs |
| `icon`        | Name of an SVG file of `icons/`       |
| `name`        | Name of the folder of the example     |
| `title`       | Title of the card, such as `CLI`      |

### Source links

The API reference of an export is its TSDoc. `SourceLink` of `src/components/SourceLink.tsx` links the name of an export to the TSDoc of its declaration on GitHub, as a line range, in a new tab. A page links each API or interface of the package that its prose names in inline code, at each use.

```mdx
The call of <SourceLink name="pay" path="src/Accounts.ts">`pay`</SourceLink> pays.
```

| Property | Value                                                       |
| -------- | ----------------------------------------------------------- |
| `name`   | Name of the declaration, such as `signIn` or `session.get`  |
| `path`   | Path of its file from the root of the repository, in `src/` |

The declaration is the first line of the file that declares `name` as an export or a member, after the end of a TSDoc comment. A dotted name, such as `session.get`, finds each part after the line of the part before it, so it names a member that an earlier declaration of the file shares. The server render reads the file at each build, so the line follows each edit, and no browser bundle holds the source. If the file or the declaration is missing, the build fails.

The link names the commit of the build, `git rev-parse HEAD`, which `vite.config.ts` defines as `import.meta.env.SITE_COMMIT`. The line and the file on GitHub thus match on each deployment, also one that lags `main`. The workflow builds the head commit of a pull request, not its merge ref, since GitHub holds no lasting merge commit. A local build with commits that are not pushed links to a commit that GitHub does not hold.

## Demos

A demo is an interactive example that runs the package in the page, against Tempo ID and Tempo testnet. If the flow of a demo needs a server, the demo calls a [route of the site](#server).

`src/demos/<Name>.tsx` holds one demo. Its name is the title of its guide in PascalCase, such as `RevokeAccessKeys`, so each name is unique. A module that demos share is in `src/demos/<topic>/`. Its default export is the component, and its `accounts` export is the instance, which the reset control of the frame signs out. The instances of all demos share one stored session, so a demo that holds no session exports no `accounts`.

```tsx [src/demos/SignIn.tsx]
'use client'

import { Accounts } from 'accounts'
import { react } from 'accounts/react'
import { DemoButton, DemoStep } from '../components/Demo.tsx'

export const accounts = Accounts.create({
  chain: 'testnet',
  plugins: [react()],
})

export default function SignIn() {
  const { session } = accounts.useSession()

  return (
    <DemoStep
      detail={session && `Signed in as ${session.user.email}.`}
      label="Sign in, or create a Tempo Account."
      number={1}
      state={session ? 'done' : 'active'}
    >
      {/* A refused sign-in changes nothing, so the control drops its failure. */}
      <DemoButton onClick={() => void accounts.dialog.signIn().catch(() => {})}>
        Sign in
      </DemoButton>
    </DemoStep>
  )
}
```

`Demo` of `src/components/Demo.tsx` shows the demo of `name` in a frame:

```mdx
<Demo name="SignIn" source="examples/web" title="Sign in" />
```

| Property                                            | Value                                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------------- |
| `name`                                              | File                                                                      | Use |
| --------------------------------------------        | ------------------------------------------------------------------        |
| `public/tempo-light.svg`, `public/tempo-dark.svg`   | Icons of the browser tab, for the light and the dark color scheme         |
| `public/lockup-light.svg`, `public/lockup-dark.svg` | Tempo's wordmark at the top left, for the light and the dark color scheme |
| `public/favicon.ico`                                | Icon of 16, 32, and 48 pixels, for clients that read no SVG               |
| `public/apple-touch-icon.png`                       | Icon of 180 pixels of iOS                                                 |
| `public/icon-192.png`, `public/icon-512.png`        | Icons of `public/site.webmanifest`, such as for Android                   |

Each icon is the icon of Tempo. The SVG files are copies of the icons of the v0 docs, and the raster files are copies of those of tempo.xyz.

`/llms.txt` links the Markdown of every page in sidebar order, and `/llms-full.txt` joins the pages. A page path with `.md` returns its Markdown, and each page names it in a `<link rel="alternate" type="text/markdown">`.
