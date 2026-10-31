type Node = {
  type: string
  name?: string | null | undefined
  value?: string | undefined
  children?: Node[] | undefined
  attributes?: { name?: string | undefined; value?: unknown }[] | undefined
  [key: string]: unknown
}

const demos: Record<string, string> = {
  Authenticate: 'Authenticate an account',
  ConnectAccount: 'Connect an account',
  DepositFunds: 'Deposit funds',
  SendPayment: 'Send a payment',
  ServerTransfer: 'Send a server transfer',
  SponsoredPayment: 'Send a sponsored payment',
  SubscriptionPayment: 'Make a subscription payment',
  SwapTokens: 'Swap tokens',
}

/** Render interactive MDX as semantic Markdown without changing the React site. */
export default function remarkMarkdown() {
  return (tree: Node) => {
    tree.children = transform(tree.children ?? [])
  }
}

function text(value: string) {
  return { type: 'text', value }
}

function paragraph(value: string): Node {
  return { type: 'paragraph', children: [text(value)] }
}

function link(url: string, value: string): Node {
  return { type: 'link', url, children: [text(value)] }
}

function heading(value: string): Node {
  return { type: 'heading', depth: 4, children: [text(value)] }
}

function property(node: Node, name: string) {
  const value = node.attributes?.find((item) => item.name === name)?.value
  if (typeof value === 'string') return value
  // Read static JSX text from expression props; never execute author expressions.
  function content(value: unknown): string {
    if (!value || typeof value !== 'object') return ''
    if (Array.isArray(value)) return value.map(content).join(' ')
    const item = value as Record<string, unknown>
    if (item.type === 'JSXText' && typeof item.value === 'string') return item.value
    return Object.entries(item)
      .filter(([key]) => !['position', 'loc', 'attributes'].includes(key))
      .map(([, value]) => content(value))
      .join(' ')
  }
  return content(value).replace(/\s+/g, ' ').trim()
}

function required(node: Node, name: string) {
  const value = property(node, name)
  if (!value) throw new Error(`${node.name} requires static ${name} for Markdown output`)
  return value
}

function transform(nodes: Node[]): Node[] {
  return nodes.flatMap((node): Node[] => {
    if (node.type === 'mdxjsEsm') return []
    if (node.type === 'mdxFlowExpression' || node.type === 'mdxTextExpression') {
      if (!node.value?.trim() || /^\s*\/\*/.test(node.value)) return []
      throw new Error(`Unrendered Markdown expression: ${node.value}`)
    }
    if (node.type !== 'mdxJsxFlowElement' && node.type !== 'mdxJsxTextElement')
      return [{ ...node, ...(node.children ? { children: transform(node.children) } : {}) }]
    const children = transform(node.children ?? [])
    const name = node.name ?? ''
    if (['Cards', 'Tabs', 'CheckboxCards', 'DemoReset'].includes(name)) return children
    if (name === 'Tab') return [heading(required(node, 'title')), ...children]
    if (name === 'Card')
      return [
        {
          type: 'paragraph',
          children: [
            link(required(node, 'to'), required(node, 'title')),
            text(`: ${property(node, 'description')}`),
          ],
        },
      ]
    if (name === 'CheckboxCard')
      return [
        ...children,
        { type: 'paragraph', children: [link(required(node, 'href'), 'Requirement details')] },
      ]
    if (name === 'Demo')
      return [
        heading(required(node, 'title')),
        {
          type: 'paragraph',
          children: [link(required(node, 'githubUrl'), 'Runnable example source')],
        },
        ...children,
      ]
    if (name === 'Steps.Step') return [paragraph(required(node, 'label')), ...children]
    if (name === 'LandingPage')
      return [
        paragraph('Tempo Accounts SDK: create, manage, and interact with accounts on Tempo.'),
        {
          type: 'paragraph',
          children: [
            link('/docs', 'Get started'),
            text(' · '),
            link('/docs/production', 'Deploy to production'),
          ],
        },
      ]
    if (demos[name])
      return [
        paragraph(
          `Interactive demo: ${demos[name]}. Run it in the browser or use the linked example source.`,
        ),
      ]
    throw new Error(`Add a semantic Markdown renderer for <${name}>`)
  })
}
