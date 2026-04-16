import { Amount } from '#/ui/Amount.js'
import { Button } from '#/ui/Button.js'
import { Frame } from '#/ui/Frame.js'
import { Identicon } from '#/ui/Identicon.js'
import { Input } from '#/ui/Input.js'
import { ThemeToggle } from '#/ui/ThemeToggle.js'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

export const Route = createFileRoute('/design')({
  component: Design,
})

const scales = ['gray', 'blue', 'red', 'amber', 'green', 'purple'] as const
const steps = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const

const sidebar = [
  { id: 'colors', label: 'Colors' },
  { id: 'typography', label: 'Typography' },
  { id: 'amount-component', label: 'Amount' },
  { id: 'button-component', label: 'Button' },
  { id: 'input-component', label: 'Input' },
  { id: 'frame-component', label: 'Frame' },
  { id: 'identicon-component', label: 'Identicon' },
] as const

const externalLinks = [{ href: '/design/frames', label: 'Frames →' }] as const

function useActiveSection(ids: readonly string[]) {
  const [active, setActive] = useState(ids[0]!)

  useEffect(() => {
    const elements = ids.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[]
    if (elements.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setActive(entry.target.id)
      },
      { rootMargin: '0px 0px -60% 0px', threshold: 0 },
    )
    for (const el of elements) observer.observe(el)
    return () => observer.disconnect()
  }, [ids])

  return active
}

function Design() {
  const active = useActiveSection(sidebar.map((s) => s.id))

  return (
    <div className="flex min-h-dvh">
      <ThemeToggle className="fixed top-4 right-4 z-50" />
      <nav className="sticky top-0 h-dvh w-56 shrink-0 overflow-y-auto border-r border-border px-4 py-6 max-lg:hidden">
        <ul role="list" className="space-y-1">
          {sidebar.map((item) => (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                className={`text-label-13 block rounded-md px-2 py-1.5 transition-colors ${
                  active === item.id
                    ? 'text-foreground bg-gray-2'
                    : 'text-foreground-secondary hover:text-foreground hover:bg-gray-2'
                }`}
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
        <div className="border-t border-border pt-3 mt-3">
          <ul role="list" className="space-y-1">
            {externalLinks.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="text-label-13 block rounded-md px-2 py-1.5 text-foreground-secondary transition-colors hover:text-foreground hover:bg-gray-2"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      <main className="min-w-0 flex-1 py-12">
        <div className="max-w-2xl px-8 lg:px-12">
          <h1 className="text-heading-32">Design Playground</h1>
          <p className="mt-3 text-copy-14 text-foreground-secondary">
            Visual reference for the design system powering Tempo Connect.
          </p>

          <GroupHeading id="colors">Colors</GroupHeading>

          <SectionHeading id="scales">Scales</SectionHeading>
          <p className="text-copy-14 text-foreground-secondary">
            10 color scales. P3 colors on supported browsers and displays.
          </p>

          <div className="mt-8 space-y-5">
            {scales.map((scale) => (
              <ScaleRow key={scale} name={scale} />
            ))}
          </div>

          <SectionHeading id="backgrounds">Backgrounds</SectionHeading>
          <p className="text-copy-14 text-foreground-secondary">
            Two background colors. Use Background 1 in most cases—especially when color sits on top.
            Background 2 for subtle differentiation.
          </p>

          <div className="mt-6 grid grid-cols-2 gap-4">
            <BackgroundCard
              color="var(--bg-100)"
              label="Background 1"
              description="Default element background"
            />
            <BackgroundCard
              color="var(--bg-200)"
              label="Background 2"
              description="Secondary background"
            />
          </div>

          <SectionHeading id="component-backgrounds">
            Colors 1–3: Component Backgrounds
          </SectionHeading>
          <p className="text-copy-14 text-foreground-secondary">UI component backgrounds.</p>

          <div className="mt-6 grid grid-cols-3 gap-4">
            <TokenCard step={1} label="Color 1" description="Default background" />
            <TokenCard step={2} label="Color 2" description="Hover background" />
            <TokenCard step={3} label="Color 3" description="Active background" />
          </div>

          <SectionHeading id="borders">Colors 4–6: Borders</SectionHeading>
          <p className="text-copy-14 text-foreground-secondary">UI component borders.</p>

          <div className="mt-6 grid grid-cols-3 gap-4">
            <TokenCard step={4} label="Color 4" description="Default border" />
            <TokenCard step={5} label="Color 5" description="Hover border" />
            <TokenCard step={6} label="Color 6" description="Active border" />
          </div>

          <SectionHeading id="high-contrast">Colors 7–8: High Contrast Backgrounds</SectionHeading>
          <p className="text-copy-14 text-foreground-secondary">
            High contrast UI component backgrounds.
          </p>

          <div className="mt-6 grid grid-cols-2 gap-4">
            <TokenCard step={7} label="Color 7" description="High contrast background" />
            <TokenCard step={8} label="Color 8" description="Hover high contrast background" />
          </div>

          <SectionHeading id="text-icons">Colors 9–10: Text and Icons</SectionHeading>
          <p className="text-copy-14 text-foreground-secondary">Accessible text and icons.</p>

          <div className="mt-6 grid grid-cols-2 gap-4">
            <TokenCard step={9} label="Color 9" description="Secondary text and icons" />
            <TokenCard step={10} label="Color 10" description="Primary text and icons" />
          </div>

          <GroupHeading id="typography">Typography</GroupHeading>
          <p className="text-copy-14 text-foreground-secondary">
            Type scale using Geist. Each class sets font-size, line-height, letter-spacing, and
            font-weight.
          </p>

          <SectionHeading id="headings">Headings</SectionHeading>
          <div className="space-y-0 divide-y divide-black/5 dark:divide-white/5">
            <TypeRow className="text-heading-48" label="Heading 48" />
            <TypeRow className="text-heading-32" label="Heading 32" />
            <TypeRow className="text-heading-24" label="Heading 24" />
            <TypeRow className="text-heading-20" label="Heading 20" />
            <TypeRow className="text-heading-16" label="Heading 16" />
            <TypeRow className="text-heading-14" label="Heading 14" />
          </div>

          <SectionHeading id="copy">Copy</SectionHeading>
          <div className="space-y-0 divide-y divide-black/5 dark:divide-white/5">
            <TypeRow
              className="text-copy-24"
              label="Copy 24"
              sample="Build, scale, and secure a faster, personalized web."
            />
            <TypeRow
              className="text-copy-20"
              label="Copy 20"
              sample="Build, scale, and secure a faster, personalized web."
            />
            <TypeRow
              className="text-copy-16"
              label="Copy 16"
              sample="Build, scale, and secure a faster, personalized web."
            />
            <TypeRow
              className="text-copy-14"
              label="Copy 14"
              sample="Build, scale, and secure a faster, personalized web."
            />
            <TypeRow
              className="text-copy-13"
              label="Copy 13"
              sample="Build, scale, and secure a faster, personalized web."
            />
          </div>

          <SectionHeading id="labels">Labels</SectionHeading>
          <div className="space-y-0 divide-y divide-black/5 dark:divide-white/5">
            <TypeRow className="text-label-20" label="Label 20" sample="Menu item" />
            <TypeRow className="text-label-16" label="Label 16" sample="Menu item" />
            <TypeRow className="text-label-14" label="Label 14" sample="Menu item" />
            <TypeRow className="text-label-13" label="Label 13" sample="Menu item" />
            <TypeRow className="text-label-12" label="Label 12" sample="Menu item" />
          </div>

          <SectionHeading id="buttons">Buttons</SectionHeading>
          <div className="space-y-0 divide-y divide-black/5 dark:divide-white/5">
            <TypeRow className="text-button-16" label="Button 16" sample="Continue" />
            <TypeRow className="text-button-14" label="Button 14" sample="Continue" />
            <TypeRow className="text-button-12" label="Button 12" sample="Continue" />
          </div>

          <GroupHeading id="amount-component">Amount</GroupHeading>
          <p className="text-copy-14 text-foreground-secondary">
            Toggleable display that crossfades between fiat and crypto values. Click to toggle.
          </p>

          <div className="mt-6 space-y-6">
            <div>
              <p className="text-heading-16 mb-3">Default</p>
              <Amount
                amount={{
                  amount: '0x2386f26fc10000',
                  decimals: 18,
                  formatted: '0.01',
                  symbol: 'PathUSD',
                }}
              />
            </div>

            <div>
              <p className="text-heading-16 mb-3">Sizes</p>
              <div className="flex flex-wrap items-center gap-3">
                <Amount
                  amount={{
                    amount: '0x6f05b59d3b20000',
                    decimals: 18,
                    formatted: '50.00',
                    symbol: 'PathUSD',
                  }}
                />
                <Amount
                  amount={{
                    amount: '0x6f05b59d3b20000',
                    decimals: 18,
                    formatted: '50.00',
                    symbol: 'PathUSD',
                  }}
                  size="lg"
                />
              </div>
            </div>

            <div>
              <p className="text-heading-16 mb-3">Sign</p>
              <div className="flex flex-wrap items-center gap-3">
                <Amount
                  amount={{
                    amount: '0x6f05b59d3b20000',
                    decimals: 18,
                    formatted: '25.00',
                    symbol: 'PathUSD',
                  }}
                  sign="−"
                />
                <Amount
                  amount={{
                    amount: '0x6f05b59d3b20000',
                    decimals: 18,
                    formatted: '25.00',
                    symbol: 'PathUSD',
                  }}
                  sign="+"
                />
              </div>
            </div>

            <div>
              <p className="text-heading-16 mb-3">Strikethrough</p>
              <Amount
                amount={{
                  amount: '0x2386f26fc10000',
                  decimals: 18,
                  formatted: '0.01',
                  symbol: 'PathUSD',
                }}
                strikethrough
              />
            </div>

            <div>
              <p className="text-heading-16 mb-3">Alignment</p>
              <div className="flex flex-col gap-2 rounded-body border border-border p-3">
                {(['left', 'center', 'right'] as const).map((align) => (
                  <div className="flex items-center gap-3" key={align}>
                    <p className="w-14 text-label-12 text-foreground-secondary">{align}</p>
                    <Amount
                      align={align}
                      amount={{
                        amount: '0x6f05b59d3b20000',
                        decimals: 18,
                        formatted: '50.00',
                        symbol: 'PathUSD',
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <GroupHeading id="button-component">Button</GroupHeading>
          <p className="text-copy-14 text-foreground-secondary">
            Variants, sizes, shapes, and states.
          </p>

          <div className="mt-6 space-y-6">
            <div>
              <p className="text-heading-16 mb-3">Variants</p>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="primary">Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="muted">Muted</Button>
                <Button variant="invert">Invert</Button>
                <Button variant="error">Error</Button>
                <Button variant="warning">Warning</Button>
              </div>
            </div>

            <div>
              <p className="text-heading-16 mb-3">Sizes</p>
              <div className="flex flex-wrap items-center gap-3">
                <Button size="small">Small</Button>
                <Button size="medium">Medium</Button>
                <Button size="large">Large</Button>
              </div>
            </div>

            <div>
              <p className="text-heading-16 mb-3">Shapes</p>
              <div className="flex flex-wrap items-center gap-3">
                <Button shape="default">Default</Button>
                <Button shape="rounded">Rounded</Button>
                <Button shape="square" aria-label="Star">
                  ★
                </Button>
                <Button shape="circle" aria-label="Star">
                  ★
                </Button>
              </div>
            </div>

            <div>
              <p className="text-heading-16 mb-3">States</p>
              <div className="flex flex-wrap items-center gap-3">
                <Button loading>Loading</Button>
                <Button disabled>Disabled</Button>
              </div>
            </div>
          </div>

          <GroupHeading id="input-component">Input</GroupHeading>
          <p className="text-copy-14 text-foreground-secondary">
            Sizes, prefix/suffix, label, and states.
          </p>

          <div className="mt-6 space-y-6">
            <div>
              <p className="text-heading-16 mb-3">Default</p>
              <Input placeholder="Email address…" />
            </div>

            <div>
              <p className="text-heading-16 mb-3">Sizes</p>
              <div className="space-y-3">
                <Input placeholder="Small…" size="small" />
                <Input placeholder="Medium…" size="medium" />
                <Input placeholder="Large…" size="large" />
              </div>
            </div>

            <div>
              <p className="text-heading-16 mb-3">Prefix &amp; Suffix</p>
              <div className="space-y-3">
                <Input placeholder=".com" prefix="https://" />
                <Input placeholder="repository" suffix="/" />
              </div>
            </div>

            <div>
              <p className="text-heading-16 mb-3">Label</p>
              <Input id="demo-label" label="Label" placeholder="With a label…" />
            </div>

            <div>
              <p className="text-heading-16 mb-3">States</p>
              <div className="space-y-3">
                <Input error="An error message." placeholder="Error…" />
                <Input disabled placeholder="Disabled…" />
              </div>
            </div>
          </div>

          <GroupHeading id="frame-component">Frame</GroupHeading>
          <p className="text-copy-14 text-foreground-secondary">
            Card shell for dialog screens with header, body, footer, and action buttons.
          </p>

          <div className="mt-6">
            <div className="w-[360px] rounded-2xl border border-border bg-primary">
              <Frame>
                <Frame.Header
                  subtitle="A short description of the request goes here."
                  title="Title"
                />
                <Frame.Body>
                  <p className="text-copy-14 text-foreground-secondary">
                    Body content goes here. This could be details, a form, or any other content
                    relevant to the request.
                  </p>
                </Frame.Body>
                <Frame.Footer>
                  <Frame.ActionButtons />
                </Frame.Footer>
              </Frame>
            </div>
          </div>

          <GroupHeading id="identicon-component">Identicon</GroupHeading>
          <p className="text-copy-15 text-foreground-secondary">
            Deterministic address identicons using design system colors.
          </p>
          <div className="mt-6 flex flex-wrap gap-8">
            {[
              '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
              '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
              '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
              '0xBE0eB53F46cd790Cd13851d5EFf43D12404d33E8',
            ].map((addr) => (
              <div key={addr} className="flex flex-col items-center gap-2">
                <Identicon address={addr as `0x${string}`} className="rounded-full" size={48} />
                <p className="font-mono text-label-11 text-foreground-secondary">
                  {addr.slice(0, 6)}…{addr.slice(-4)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}

function GroupHeading(props: { children: React.ReactNode; id: string }) {
  return (
    <h2
      id={props.id}
      className="text-heading-24 mt-16 mb-2 pb-4 border-b border-border scroll-mt-8"
    >
      {props.children}
    </h2>
  )
}

function SectionHeading(props: { children: React.ReactNode; id: string }) {
  return (
    <h3 id={props.id} className="text-heading-20 mt-10 mb-3 scroll-mt-8">
      {props.children}
    </h3>
  )
}

function ScaleRow(props: { name: string }) {
  return (
    <div>
      <p className="text-label-13 text-foreground-secondary mb-1.5 capitalize">{props.name}</p>
      <div className="flex gap-0.5">
        {steps.map((step) => (
          <div
            key={step}
            className="flex-1 h-8 first:rounded-l-lg last:rounded-r-lg"
            style={{ backgroundColor: `var(--${props.name}-${step})` }}
          />
        ))}
      </div>
    </div>
  )
}

function BackgroundCard(props: { color: string; label: string; description: string }) {
  return (
    <div>
      <div
        className="h-20 rounded-body border border-border"
        style={{ backgroundColor: props.color }}
      />
      <p className="text-label-14 mt-2">{props.label}</p>
      <p className="text-label-13 text-foreground-secondary">{props.description}</p>
    </div>
  )
}

function TokenCard(props: { step: number; label: string; description: string }) {
  return (
    <div>
      <div className="flex gap-0.5">
        {scales.map((scale) => (
          <div
            key={scale}
            className="flex-1 h-8 first:rounded-l-lg last:rounded-r-lg"
            style={{ backgroundColor: `var(--${scale}-${props.step})` }}
          />
        ))}
      </div>
      <p className="text-label-14 mt-2">{props.label}</p>
      <p className="text-label-13 text-foreground-secondary">{props.description}</p>
    </div>
  )
}

function TypeRow(props: { className: string; label: string; sample?: string | undefined }) {
  return (
    <div className="flex items-baseline gap-4 py-4">
      <p className="text-label-12 text-foreground-secondary w-24 shrink-0 tabular-nums">
        {props.label}
      </p>
      <p className={props.className}>{props.sample ?? 'The quick brown fox'}</p>
    </div>
  )
}
