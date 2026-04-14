import { Button } from '#/ui/Button.js'
import { Frame } from '#/ui/Frame.js'
import { Identicon } from '#/ui/Identicon.js'
import { Input } from '#/ui/Input.js'
import { Otp } from '#/ui/Otp.js'
import { ThemeToggle } from '#/ui/ThemeToggle.js'
import { createFileRoute } from '@tanstack/react-router'
import { Cuer } from 'cuer'
import { cx } from 'cva'
import { useEffect, useState } from 'react'
import ArrowRightLeft from '~icons/lucide/arrow-right-left'
import ArrowUpRight from '~icons/lucide/arrow-up-right'
import ChevronDown from '~icons/lucide/chevron-down'
import ChevronRight from '~icons/lucide/chevron-right'
import CirclePlus from '~icons/lucide/circle-plus'
import Copy from '~icons/lucide/copy'
import Fingerprint from '~icons/lucide/fingerprint'
import LogIn from '~icons/lucide/log-in'
import Mail from '~icons/lucide/mail'
import Shield from '~icons/lucide/shield-check'
import Terminal from '~icons/lucide/terminal'

export const Route = createFileRoute('/design')({
  component: Design,
})

const scales = ['gray', 'blue', 'red', 'amber', 'green', 'teal', 'purple', 'pink'] as const
const steps = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const

const sidebar = [
  { id: 'colors', label: 'Colors' },
  { id: 'typography', label: 'Typography' },
  { id: 'button-component', label: 'Button' },
  { id: 'input-component', label: 'Input' },
  { id: 'otp-component', label: 'OTP' },
  { id: 'frame-component', label: 'Frame' },
  { id: 'identicon-component', label: 'Identicon' },
] as const

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

          <GroupHeading id="otp-component">OTP</GroupHeading>
          <p className="text-copy-14 text-foreground-secondary">
            Numeric one-time-password input with individual digit cells.
          </p>

          <div className="mt-6 space-y-6">
            <div>
              <p className="text-heading-16 mb-3">Default</p>
              <OtpDemo />
            </div>

            <div>
              <p className="text-heading-16 mb-3">Sizes</p>
              <div className="space-y-3">
                <OtpDemo size="small" />
                <OtpDemo size="medium" />
                <OtpDemo size="large" />
              </div>
            </div>

            <div>
              <p className="text-heading-16 mb-3">States</p>
              <div className="space-y-3">
                <Otp error="Invalid code. Please try again." value="123456" />
                <Otp disabled value="123456" />
              </div>
            </div>
          </div>

          <GroupHeading id="frame-component">Frame</GroupHeading>
          <p className="text-copy-14 text-foreground-secondary">
            Card shell for dialog screens with header, body, footer, and action buttons.
          </p>

          <div className="mt-6 space-y-6">
            <div>
              <p className="text-heading-16 mb-3">Stub</p>
              <div className="w-[360px] rounded-lg border border-border bg-primary">
                <Frame>
                  <Frame.Header
                    icon={<ArrowUpRight className="size-5" />}
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

            <div>
              <p className="text-heading-16 mb-3">Transaction Request</p>
              <div className="w-[360px] rounded-lg border border-border bg-primary">
                <Frame>
                  <Frame.Header
                    icon={<ArrowUpRight className="size-5" />}
                     title="Review Transaction"
                  />
                  <Frame.Body>
                    <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                      <BalanceDiff
                        addressLabel="to"
                        addressValue="0x1a2b…9e8f"
                        detail="50 USDC"
                        label="Send USDC"
                        type="debit"
                        value="−$50.00"
                      />
                      <BalanceDiff
                        addressLabel="from"
                        addressValue="0xab12…34cd"
                        detail="49.85 USDC.e"
                        label="Receive USDC.e"
                        type="credit"
                        value="+$49.85"
                      />
                    </div>

                    <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                      <ScopeRow label="Fee" value="$0.01" />
                    </div>
                  </Frame.Body>
                  <Frame.Footer>
                    <Frame.ActionButtons primaryLabel="Approve" secondaryLabel="Reject" />
                  </Frame.Footer>
                </Frame>
              </div>
            </div>

            <div>
              <p className="text-heading-16 mb-3">Direct Payment</p>
              <div className="w-[360px] rounded-lg border border-border bg-primary">
                <Frame>
                  <Frame.Header
                    icon={<ArrowUpRight className="size-5" />}
                    subtitle={
                      <>
                        <span className="text-foreground">example.com</span> is requesting a
                        payment.
                      </>
                    }
                    title="Payment Request"
                  />
                  <Frame.Body>
                    <div className="flex flex-col items-center gap-1 rounded-xl bg-gray-1 px-4 py-5 text-center">
                      <p className="text-heading-32 tabular-nums">$50.00</p>
                      <p className="font-mono text-label-13 text-foreground-secondary">
                        to 0x1a2b…9e8f
                      </p>
                    </div>

                    <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                      <ScopeRow label="Currency" value="USDC.e" />
                      <ScopeRow label="Fee" value="$0.01" />
                    </div>
                  </Frame.Body>
                  <Frame.Footer>
                    <Frame.ActionButtons primaryLabel="Pay $50.00" secondaryLabel="Reject" />
                  </Frame.Footer>
                </Frame>
              </div>
            </div>

            <div>
              <p className="text-heading-16 mb-3">Authorize</p>
              <div className="w-[360px] rounded-lg border border-border bg-primary">
                <Frame>
                  <Frame.Header
                    icon={<Terminal className="size-5" />}
                    subtitle={<><span className="text-foreground">Amp</span> is requesting to access your account.</>}
                     title="Authorize CLI"
                  />
                  <Frame.Body>
                    <div className="flex flex-col gap-3 rounded-xl bg-gray-1 px-4 py-5 text-center">
                      <p className="text-label-12 text-foreground-secondary">
                        Confirm this code matches your terminal
                      </p>
                      <p className="font-mono text-heading-32 tracking-[0.3em]">TRMK-92QF</p>
                    </div>

                    <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                      <ScopeRow label="Spend USDC.e" value="$100.00" />
                      <ScopeRow label="Expires" value="24 hours" />
                    </div>
                  </Frame.Body>
                  <Frame.Footer>
                    <Frame.ActionButtons primaryLabel="Approve" secondaryLabel="Reject" />
                  </Frame.Footer>
                </Frame>
              </div>
            </div>
            <div>
              <p className="text-heading-16 mb-3">Sign In</p>
              <div className="w-[360px] rounded-lg border border-border bg-primary">
                <Frame>
                  <Frame.Header
                    icon={<LogIn className="size-5" />}
                    subtitle={
                      <>
                        Sign into <span className="text-foreground">example.com</span> using your
                        email address or passkey.
                      </>
                    }
                    title="Sign in with Tempo"
                  />
                  <Frame.Body>
                    <Input placeholder="Email address…" type="email" />
                    <Button variant="primary">Continue</Button>

                    <div className="flex items-center gap-3">
                      <div className="h-px flex-1 bg-border" />
                      <p className="text-label-12 text-foreground-secondary">or</p>
                      <div className="h-px flex-1 bg-border" />
                    </div>

                    <Button prefix={<Fingerprint className="size-4" />} variant="muted">
                      Continue with passkey
                    </Button>

                    <p className="text-center text-label-12 text-foreground-secondary">
                      By continuing, you agree to the Terms of Service.
                    </p>
                  </Frame.Body>
                </Frame>
              </div>
            </div>

            <div>
              <p className="text-heading-16 mb-3">Verify OTP</p>
              <div className="w-[360px] rounded-lg border border-border bg-primary">
                <Frame>
                  <Frame.Header
                    icon={<Mail className="size-5" />}
                    subtitle={
                      <>
                        Enter the 6-digit code we sent to{' '}
                        <span className="text-foreground">j***@example.com</span>
                      </>
                    }
                    title="Check your email"
                  />
                  <Frame.Body>
                    <OtpDemo size="large" />
                    <div className="flex items-center justify-center gap-3">
                      <button
                        className="cursor-pointer text-label-13 text-foreground-secondary transition-colors hover:text-foreground"
                        type="button"
                      >
                        Resend code
                      </button>
                      <span className="text-label-13 text-foreground-secondary">·</span>
                      <button
                        className="cursor-pointer text-label-13 text-foreground-secondary transition-colors hover:text-foreground"
                        type="button"
                      >
                        Use a different email
                      </button>
                    </div>
                  </Frame.Body>
                </Frame>
              </div>
            </div>

            <div>
              <p className="text-heading-16 mb-3">Logged In</p>
              <div className="w-[360px] rounded-lg border border-border bg-primary">
                <Frame>
                  <Frame.Header
                    icon={<LogIn className="size-5" />}
                    subtitle={
                      <>
                        You're signing in to <span className="text-foreground">example.com</span>
                      </>
                    }
                    title="Welcome Back"
                  />
                  <Frame.Footer>
                    <div className="flex flex-col gap-4">
                      <button
                        className="flex h-[38px] w-full cursor-pointer items-center gap-3 rounded-lg border border-border px-3 transition-colors hover:bg-gray-1"
                        type="button"
                      >
                        <Identicon
                          address="0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9e8f"
                          className="size-6 shrink-0 rounded-full"
                          size={24}
                        />
                        <p className="min-w-0 flex-1 truncate text-left text-label-13">
                          john@example.com
                        </p>
                        <ChevronRight className="size-4 shrink-0 text-foreground-secondary" />
                      </button>
                      <Button prefix={<Fingerprint className="size-4" />} variant="primary">
                        Continue with passkey
                      </Button>
                      <button
                        className="cursor-pointer text-label-13 text-foreground-secondary transition-colors hover:text-foreground"
                        type="button"
                      >
                        Create another account
                      </button>
                    </div>
                  </Frame.Footer>
                </Frame>
              </div>
            </div>

            <div>
              <p className="text-heading-16 mb-3">Authorize Spend</p>
              <div className="w-[360px] rounded-lg border border-border bg-primary">
                <Frame>
                  <Frame.Header
                    icon={<Shield className="size-5" />}
                    subtitle={
                      <>
                        <span className="text-foreground">example.com</span> is requesting to spend
                        from your account.
                      </>
                    }
                    title="Authorize Spend"
                  />
                  <Frame.Body>
                    <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                      <ScopeRow label="Spend USDC.e" suffix="/ hour" value="$100.00" />
                      <ScopeRow label="Spend USDC" suffix="/ hour" value="$50.00" />
                      <ScopeRow label="Expires" value="24 hours" />
                    </div>
                  </Frame.Body>
                  <Frame.Footer>
                    <Frame.ActionButtons primaryLabel="Approve" secondaryLabel="Reject" />
                  </Frame.Footer>
                </Frame>
              </div>
            </div>

            <div>
              <p className="text-heading-16 mb-3">Deposit</p>
              <div className="w-[360px] rounded-lg border border-border bg-primary">
                <Frame>
                  <Frame.Header
                    icon={<CirclePlus className="size-5" />}
                    subtitle={
                      <>
                        Deposit <span className="text-foreground">$50.00</span> to continue.
                      </>
                    }
                    title="Add Funds"
                  />
                  <Frame.Body>
                    <div className="flex flex-col gap-3 rounded-xl border border-border px-4 py-3.5">
                      <div className="flex items-center justify-between">
                        <p className="text-label-13 text-foreground-secondary">Deposit address</p>
                        <div className="flex items-center gap-1.5 rounded-full bg-blue-2 px-2 py-0.5 text-label-12 font-medium text-blue-9">
                          <span className="size-1.5 rounded-full bg-blue-7" />
                          Base
                        </div>
                      </div>
                      <div className="flex justify-center py-2">
                        <Cuer value="0x9f8e7d6c5b4a39281e0f3c21d7a4b6" size="140px" />
                      </div>
                      <div className="flex items-center justify-center gap-1.5">
                        <p className="font-mono text-label-13 text-foreground-secondary">
                          0x9f8e…3c21d7a4b6
                        </p>
                        <button
                          className="cursor-pointer text-foreground-secondary opacity-60 transition-opacity hover:opacity-100"
                          type="button"
                        >
                          <Copy className="size-3" />
                        </button>
                      </div>
                    </div>

                    <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                      <ScopeRow
                        label="Network"
                        value={
                          <>
                            Base
                            <ChevronDown className="size-3.5 text-foreground-secondary" />
                          </>
                        }
                      />
                      <ScopeRow
                        label="Token"
                        value={
                          <>
                            USDC
                            <ChevronDown className="size-3.5 text-foreground-secondary" />
                          </>
                        }
                      />
                    </div>

                    <div className="rounded-lg bg-amber-1 px-3 py-2 text-label-12 text-amber-9">
                      ⚠ Only send USDC on Base network. Sending other tokens or using a different
                      network may result in permanent loss.
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="h-px flex-1 bg-border" />
                      <p className="text-label-12 text-foreground-secondary">or</p>
                      <div className="h-px flex-1 bg-border" />
                    </div>

                    <Button variant="invert">
                      <ApplePayMark />
                    </Button>
                  </Frame.Body>
                </Frame>
              </div>
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

function ScopeRow(props: { label: string; suffix?: string | undefined; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3.5 py-2 text-label-13">
      <p className="text-foreground-secondary">{props.label}</p>
      <p className="flex items-center gap-1.5 font-medium">
        {props.value}
        {props.suffix && (
          <span className="font-normal text-foreground-secondary"> {props.suffix}</span>
        )}
      </p>
    </div>
  )
}

function BalanceDiff(props: {
  addressLabel?: string | undefined
  addressValue?: string | undefined
  detail: string
  label: string
  type: 'credit' | 'debit'
  value: string
}) {
  const [showDetail, setShowDetail] = useState(false)
  const color = props.type === 'credit' ? 'text-green-9' : 'text-red-9'

  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <div className="flex flex-col">
        <p className="text-label-14 font-medium">{props.label}</p>
        {props.addressValue && (
          <p className="flex items-center gap-1 text-[0.6875rem] text-foreground-secondary">
            {props.addressLabel && <span>{props.addressLabel} </span>}
            <span className="font-mono">{props.addressValue}</span>
            <button
              className="cursor-pointer opacity-40 transition-opacity hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation()
                navigator.clipboard.writeText(props.addressValue!)
              }}
              type="button"
            >
              <Copy className="size-2.5" />
            </button>
          </p>
        )}
      </div>
      <button
        className={cx(
          '-mr-1.5 flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-0.5 text-copy-14 font-medium tabular-nums transition-colors hover:bg-gray-1',
          color,
        )}
        onClick={() => setShowDetail((s) => !s)}
        type="button"
      >
        <span className="relative inline-grid items-center justify-items-end [&>span]:col-start-1 [&>span]:row-start-1 [&>span]:transition-opacity [&>span]:duration-150">
          <span className={showDetail ? 'opacity-0' : 'opacity-100'}>{props.value}</span>
          <span className={showDetail ? 'opacity-100' : 'opacity-0'}>{props.detail}</span>
        </span>
        <ArrowRightLeft className="size-3 opacity-50" />
      </button>
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
        className="h-20 rounded-lg border border-border"
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

function OtpDemo(props: { size?: 'large' | 'medium' | 'small' | undefined }) {
  return <Otp size={props.size} />
}

function ApplePayMark() {
  return (
    <svg className="h-[18px]" viewBox="0 0 512 210.2" fill="currentColor" aria-label="Apple Pay">
      <path d="M93.6,27.1C87.6,34.2,78,39.8,68.4,39c-1.2-9.6,3.5-19.8,9-26.1c6-7.3,16.5-12.5,25-12.9C103.4,10,99.5,19.8,93.6,27.1 M102.3,40.9c-13.9-0.8-25.8,7.9-32.4,7.9c-6.7,0-16.8-7.5-27.8-7.3c-14.3,0.2-27.6,8.3-34.9,21.2c-15,25.8-3.9,64,10.6,85c7.1,10.4,15.6,21.8,26.8,21.4c10.6-0.4,14.8-6.9,27.6-6.9c12.9,0,16.6,6.9,27.8,6.7c11.6-0.2,18.9-10.4,26-20.8c8.1-11.8,11.4-23.3,11.6-23.9c-0.2-0.2-22.4-8.7-22.6-34.3c-0.2-21.4,17.5-31.6,18.3-32.2C123.3,42.9,107.7,41.3,102.3,40.9 M182.6,11.9v155.9h24.2v-53.3h33.5c30.6,0,52.1-21,52.1-51.4c0-30.4-21.1-51.2-51.3-51.2H182.6z M206.8,32.3h27.9c21,0,33,11.2,33,30.9c0,19.7-12,31-33.1,31h-27.8V32.3z M336.6,169c15.2,0,29.3-7.7,35.7-19.9h0.5v18.7h22.4V90.2c0-22.5-18-37-45.7-37c-25.7,0-44.7,14.7-45.4,34.9h21.8c1.8-9.6,10.7-15.9,22.9-15.9c14.8,0,23.1,6.9,23.1,19.6v8.6l-30.2,1.8c-28.1,1.7-43.3,13.2-43.3,33.2C298.4,155.6,314.1,169,336.6,169z M343.1,150.5c-12.9,0-21.1-6.2-21.1-15.7c0-9.8,7.9-15.5,23-16.4l26.9-1.7v8.8C371.9,140.1,359.5,150.5,343.1,150.5z M425.1,210.2c23.6,0,34.7-9,44.4-36.3L512,54.7h-24.6l-28.5,92.1h-0.5l-28.5-92.1h-25.3l41,113.5l-2.2,6.9c-3.7,11.7-9.7,16.2-20.4,16.2c-1.9,0-5.6-0.2-7.1-0.4v18.7C417.3,210,423.3,210.2,425.1,210.2z" />
    </svg>
  )
}
