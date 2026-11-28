/** Configures the documentation site: its metadata, its navigation, and its static build. @module */
import * as fs from 'node:fs'
import { defineConfig } from 'vocs/config'

/** Repository that holds the package, its examples, and the pages of the site. */
const repository = 'https://github.com/tempoxyz/accounts'

export default defineConfig({
  // Production origin. The sitemap and the canonical URLs of every deployment name it.
  baseUrl: 'https://accounts.tempo.com',
  description:
    'The SDK of Tempo ID. Sign users in, and keep their session, their access key, and a Viem client that signs with it.',
  editLink: {
    link: `${repository}/edit/main/site/src/pages/:path`,
  },
  head: (path, context) => ({
    // Without a `<base>` element, each deployment resolves its links and assets on its own origin.
    base: false,
    link: [
      // `sizes` limits the ICO to 32 pixels, so a browser that reads both icons picks an SVG.
      { href: '/favicon.ico', rel: 'icon', sizes: '32x32' },
      { href: '/apple-touch-icon.png', rel: 'apple-touch-icon' },
      { href: '/site.webmanifest', rel: 'manifest' },
      // The Markdown of the page, which `public/_redirects` serves.
      {
        href: `${path === '/' ? '/index' : path}.md`,
        rel: 'alternate',
        type: 'text/markdown',
      },
    ],
    meta: {
      ogImageAlt: context.frontmatter?.title,
      ogImageHeight: 630,
      ogImageType: 'image/png',
      ogImageWidth: 1200,
      ogLocale: 'en_US',
      twitterImageAlt: context.frontmatter?.title,
      twitterSite: '@tempo',
    },
  }),
  // Tempo's icons, as Tempo ID's sites use. `head` names the raster icons of other clients.
  iconUrl: {
    dark: '/tempo-dark.svg',
    light: '/tempo-light.svg',
  },
  // Tempo's wordmark, as Tempo's other docs sites show it.
  logoUrl: {
    dark: '/lockup-dark.svg',
    light: '/lockup-light.svg',
  },
  // The build is static, so no server renders `/api/og`. `scripts/og.ts` writes each image after the
  // build, at the path that this URL names.
  ogImageUrl: (path, { baseUrl }) =>
    `${baseUrl}/og${path === '/' ? '/index' : path}.png`,
  redirects: [
    { destination: '/', source: '/docs' },
    { destination: '/', source: '/docs/introduction/getting-started' },
  ],
  // The build is static. Cloudflare serves the files of `dist/public`, and the Worker of
  // `src/server/` serves only the routes of the demos.
  renderStrategy: 'full-static',
  // The order of the items is the order of the sidebar.
  sidebar: [
    {
      items: [
        item({ icon: 'lightning', link: '/', text: 'Getting started' }),
        item({
          icon: 'swap-horizontal',
          link: '/docs/guides/migration',
          text: 'Migration from v0',
        }),
      ],
      text: 'Introduction',
    },
    {
      items: [
        item({
          icon: 'browser-window',
          link: '/docs/guides/dialog',
          text: 'Web',
        }),
        item({ icon: 'laptop', link: '/docs/guides/cli', text: 'CLI' }),
        item({
          icon: 'smartphone',
          link: '/docs/guides/mobile',
          text: 'Mobile',
        }),
        item({
          icon: 'server',
          link: '/docs/guides/backend',
          text: 'Backend',
        }),
        item({
          icon: 'ethereum',
          link: '/docs/guides/siwe',
          text: 'Sign-In With Ethereum',
        }),
        item({ icon: 'key', link: '/docs/guides/local', text: 'Local' }),
        item({
          icon: 'user',
          link: '/docs/guides/guest-checkout',
          text: 'Guest checkout',
        }),
        item({ icon: 'flask', link: '/docs/guides/testing', text: 'Test' }),
      ],
      text: 'Sign-in flows',
    },
    {
      items: [
        // The topics of this section are in alphabetical order.
        topic({
          guides: [
            {
              link: '/docs/guides/access-keys/authorize-access-keys',
              text: 'Authorize access keys',
            },
            {
              link: '/docs/guides/access-keys/revoke-access-keys',
              text: 'Revoke access keys',
            },
            {
              link: '/docs/guides/access-keys/bind-challenges',
              text: 'Bind challenges',
            },
          ],
          icon: 'key',
          link: '/docs/guides/access-keys',
          text: 'Access keys',
        }),
        topic({
          guides: [
            {
              link: '/docs/guides/connections/pay-for-users',
              text: 'Pay for users',
            },
            {
              link: '/docs/guides/connections/serve-access-keys',
              text: 'Serve access keys',
            },
            {
              link: '/docs/guides/connections/revoke-connections',
              text: 'Revoke connections',
            },
          ],
          icon: 'link',
          link: '/docs/guides/connections',
          text: 'Connections',
        }),
        topic({
          guides: [
            {
              link: '/docs/guides/fee-sponsorship/use-tempo-api',
              text: 'Use Tempo API',
            },
            {
              link: '/docs/guides/fee-sponsorship/host-fee-payers',
              text: 'Host fee payers',
            },
          ],
          icon: 'pay-by-hand',
          link: '/docs/guides/fee-sponsorship',
          text: 'Fee sponsorship',
        }),
        item({
          icon: 'mcp',
          link: '/docs/guides/mcp/charge-tool-calls',
          text: 'MCP',
        }),
        topic({
          guides: [
            {
              link: '/docs/guides/sessions/self-managed',
              text: 'Self-managed',
            },
            { link: '/docs/guides/sessions/mpp', text: 'MPP' },
          ],
          icon: 'pulse',
          link: '/docs/guides/sessions',
          text: 'Payment sessions',
        }),
        topic({
          guides: [
            {
              link: '/docs/guides/payments/self-managed',
              text: 'Self-managed',
            },
            { link: '/docs/guides/payments/mpp', text: 'MPP' },
          ],
          icon: 'arrow-up-right',
          link: '/docs/guides/payments',
          text: 'Payments',
        }),
        item({
          icon: 'react',
          link: '/docs/guides/react/manage-sessions',
          text: 'React',
        }),
        topic({
          guides: [
            {
              link: '/docs/guides/subscriptions/self-managed',
              text: 'Self-managed',
            },
            { link: '/docs/guides/subscriptions/mpp', text: 'MPP' },
          ],
          icon: 'repeat',
          link: '/docs/guides/subscriptions',
          text: 'Subscriptions',
        }),
        topic({
          guides: [
            {
              link: '/docs/guides/user-session/restore-sessions',
              text: 'Restore sessions',
            },
            {
              link: '/docs/guides/user-session/store-sessions',
              text: 'Store sessions',
            },
          ],
          icon: 'id-card',
          link: '/docs/guides/user-session',
          text: 'User session',
        }),
        item({ icon: 'viem', link: '/docs/guides/viem', text: 'Viem' }),
        item({ icon: 'wagmi', link: '/docs/guides/wagmi', text: 'Wagmi' }),
      ],
      text: 'Tasks after sign-in',
    },
    {
      items: [
        topic({
          guides: [
            { link: '/docs/guides/identity/read-users', text: 'Read users' },
            {
              link: '/docs/guides/identity/verify-id-tokens',
              text: 'Verify ID tokens',
            },
          ],
          icon: 'user',
          text: 'Identity',
        }),
        topic({
          guides: [
            {
              link: '/docs/guides/api-authentication/authenticate-requests',
              text: 'Authenticate requests',
            },
            {
              link: '/docs/guides/api-authentication/use-session-cookies',
              text: 'Use session cookies',
            },
            {
              link: '/docs/guides/api-authentication/bind-dpop-keys',
              text: 'Bind DPoP keys',
            },
          ],
          icon: 'shield-check',
          text: 'API authentication',
        }),
        topic({
          guides: [
            {
              link: '/docs/guides/account-proof/sign-challenges',
              text: 'Sign challenges',
            },
            {
              link: '/docs/guides/account-proof/verify-signed-messages',
              text: 'Verify signed messages',
            },
          ],
          icon: 'signed-file',
          text: 'Account proof',
        }),
        topic({
          guides: [
            { link: '/docs/guides/mpp/prove-accounts', text: 'Prove accounts' },
            {
              link: '/docs/guides/mpp/attribute-payments',
              text: 'Attribute payments',
            },
          ],
          icon: 'mpp',
          text: 'MPP',
        }),
        topic({
          guides: [
            {
              link: '/docs/guides/sign-out/end-app-sessions',
              text: 'End app sessions',
            },
            {
              link: '/docs/guides/sign-out/end-all-sessions',
              text: 'End all sessions',
            },
            {
              link: '/docs/guides/sign-out/end-backend-sessions',
              text: 'End backend sessions',
            },
          ],
          icon: 'log-out',
          text: 'Sign-out',
        }),
      ],
      text: 'Identity',
    },
    {
      items: [
        item({
          icon: 'puzzle',
          link: '/docs/guides/plugins',
          text: 'Plugins',
        }),
      ],
      text: 'Extending',
    },
  ],
  socials: [{ icon: 'github', link: repository }],
  title: 'Accounts',
  titleTemplate: '%s – Accounts SDK for Tempo',
})

/**
 * Returns the sidebar item of a page, with its icon before the text. An item is disabled until
 * `src/pages` holds the page of its `link`.
 */
function item(options: item.Options) {
  const { icon, link, text } = options

  return { badge: badge(icon), ...page(link), text }
}

declare namespace item {
  type Options = {
    /** Name of an SVG file of `icons/`, without its extension. */
    icon: string
    /** Path of the page, which is also the path of its MDX file under `src/pages`. */
    link: string
    /** Label of the item. */
    text: string
  }
}

/**
 * Returns the sidebar group of a topic, with its icon before the text. The group starts collapsed.
 * It holds the "Overview" item of the topic's `link`, if the topic has one, then one item for each
 * of its guides. An item is disabled until `src/pages` holds the page of its `link`.
 */
function topic(options: topic.Options) {
  const { guides, icon, link, text } = options

  // Vocs expands a group only for the page of an item, not for the page of a group's own `link`,
  // so the overview is an item of the group.
  const items = link ? [{ link, text: 'Overview' }, ...guides] : guides

  return {
    badge: badge(icon),
    collapsed: true,
    items: items.map((item) => ({ ...page(item.link), text: item.text })),
    text,
  }
}

declare namespace topic {
  type Options = {
    /** Guides of the topic, in the order of the sidebar. */
    guides: readonly {
      /** Path of the page, which is also the path of its MDX file under `src/pages`. */
      link: string
      /** Label of the guide. */
      text: string
    }[]
    /** Name of an SVG file of `icons/`, without its extension. */
    icon: string
    /** Path of the overview page of the topic, such as `/docs/guides/access-keys`. Without it, the group holds no "Overview" item. */
    link?: string | undefined
    /** Label of the topic. */
    text: string
  }
}

/** Returns the badge that holds the icon of `icons/<name>.svg`. */
function badge(name: string) {
  // Vocs renders an item's icon only in its badge. `src/pages/_root.css` moves it before the text.
  return {
    icon: fs.readFileSync(
      new URL(`./icons/${name}.svg`, import.meta.url),
      'utf8',
    ),
  }
}

/**
 * Returns the link of the page at `link`, or `disabled` until `src/pages` holds the page. Vocs'
 * pagination links each item with a `link`, also a disabled one, so an item without a page holds
 * no link.
 */
function page(link: string) {
  // The page of `/` is `src/pages/index.mdx`.
  const file = link === '/' ? '/index' : link
  if (fs.existsSync(new URL(`./src/pages${file}.mdx`, import.meta.url)))
    return { link }
  return { disabled: true }
}
