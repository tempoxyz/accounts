'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as React from 'react'
import { CopyButton } from 'regen-ui'
import { useDisconnect, WagmiProvider } from 'wagmi'
import LucideExternalLink from '~icons/lucide/external-link'
import LucideRotateCcw from '~icons/lucide/rotate-ccw'

import { feeSponsorshipWagmiConfig, spendPermissionsWagmiConfig, wagmiConfig } from '../wagmi.js'
import * as Steps from './Steps.js'

const queryClient = new QueryClient()
const wagmiConfigs = {
  default: wagmiConfig,
  feeSponsorship: feeSponsorshipWagmiConfig,
  spendPermissions: spendPermissionsWagmiConfig,
}

export function Demo(props: Demo.Props) {
  const {
    badge = 'DEMO',
    children,
    className,
    githubUrl,
    headerAction,
    title,
    wagmiConfig = 'default',
  } = props
  const repoPath = githubUrl.replace(/^https?:\/\/github\.com\//, '')
  const gitpickCommand = `pnpx gitpick ${repoPath}`
  return (
    <WagmiProvider config={wagmiConfigs[wagmiConfig]}>
      <QueryClientProvider client={queryClient}>
        <Steps.Provider>
          <div className="my-4 border border-primary bg-surface" data-demo>
            <Demo.Header badge={badge} headerAction={headerAction} title={title} />
            <div
              className={`border-t border-primary px-5${className ? ` ${className}` : ''}`}
              style={{ paddingTop: 16, paddingBottom: 16 }}
            >
              {children}
            </div>
            <Demo.Footer command={gitpickCommand} githubUrl={githubUrl} />
          </div>
        </Steps.Provider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}

export namespace Demo {
  export type Props = {
    badge?: string | undefined
    children: React.ReactNode
    /** Extra class names applied to the inner content area. */
    className?: string | undefined
    githubUrl: string
    /** Optional element rendered on the right side of the header (e.g. a reset button). */
    headerAction?: React.ReactNode | undefined
    title: string
    /** Which docs Wagmi config to use for this demo. */
    wagmiConfig?: keyof typeof wagmiConfigs | undefined
  }

  export function Header(props: Header.Props) {
    return (
      <div className="flex items-center gap-2 px-5 py-3">
        <span className="text-primary text-[15px] font-medium">{props.title}</span>
        <span className="bg-secondary text-secondary inline-flex items-center px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase">
          {props.badge}
        </span>
        {props.headerAction ? <div className="ml-auto">{props.headerAction}</div> : null}
      </div>
    )
  }

  export namespace Header {
    export type Props = {
      badge: string
      headerAction?: React.ReactNode | undefined
      title: string
    }
  }

  export function Footer(props: Footer.Props) {
    return (
      <div className="border-t border-primary flex items-center justify-between gap-3 px-5 py-2">
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-secondary font-mono text-[12px] truncate">
            <span className="text-muted">pnpx gitpick</span>{' '}
            <span className="text-primary">{props.command.replace(/^pnpx gitpick\s+/, '')}</span>
          </span>
          <CopyButton plain value={props.command} />
        </div>
        <a
          href={props.githubUrl}
          target="_blank"
          rel="noreferrer"
          className="text-info inline-flex items-center gap-1 text-[12px] font-medium hover:underline shrink-0"
        >
          Source
          <LucideExternalLink aria-hidden className="size-3" />
        </a>
      </div>
    )
  }

  export namespace Footer {
    export type Props = {
      command: string
      githubUrl: string
    }
  }
}

/**
 * Header action button that resets the surrounding {@link Steps.Provider}
 * and disconnects any active Wagmi connection so the demo starts fresh.
 *
 * Exported at the top level (not under {@link Demo}) so MDX/RSC can reach
 * it: client component references serialize the called function only and
 * don't carry namespace properties.
 */
export function DemoReset() {
  const steps = Steps.use()
  const disconnect = useDisconnect()
  return (
    <button
      type="button"
      aria-label="Restart"
      onClick={async () => {
        await disconnect.disconnectAsync()
        steps.set('reset')
      }}
      className="text-secondary hover:text-primary flex size-7 items-center justify-center cursor-pointer leading-none"
    >
      <LucideRotateCcw aria-hidden className="size-4 block" />
    </button>
  )
}
