/** Shows a live demo of the package in a frame, with a reset control and its source. @module */
'use client'

import type { Accounts } from 'accounts'
import {
  type ComponentType,
  lazy,
  type ReactNode,
  Suspense,
  useState,
  useSyncExternalStore,
} from 'react'
import './Demo.css'

/** Module of a demo. */
type Module = {
  /** Instance of the demo. The reset control signs out of it. */
  accounts?: Pick<Accounts.Accounts, 'signOut'> | undefined
  /** Component of the demo. */
  default: ComponentType
}

/** Repository that holds the examples, as `owner/name`. */
const repository = 'tempoxyz/accounts'

// A demo creates its instance at module scope, as an app's page does, which needs a page's origin.
// Each import runs only in a browser, when the frame first renders the demo, as its own chunk.
const loaders = Object.fromEntries(
  Object.entries(import.meta.glob<Module>('../demos/*.tsx')).map(
    ([path, load]) => [path.replace(/^.*\/|\.tsx$/g, ''), load],
  ),
)
const demos: Record<string, ComponentType> = Object.fromEntries(
  Object.entries(loaders).map(([name, load]) => [name, lazy(load)]),
)

/**
 * Shows the demo of `src/demos/<name>.tsx` in a frame. The demo renders only in a browser, after
 * hydration. The reset control signs out of the demo's instance, and mounts the demo again.
 *
 * @example
 * ```mdx
 * import { Demo } from '../../../components/Demo.tsx'
 *
 * <Demo name="SendPayment" source="examples/web" title="Send a payment" />
 * ```
 */
export function Demo(props: Demo.Props) {
  const { name, source, title } = props

  const [epoch, setEpoch] = useState(0)
  const [resetting, setResetting] = useState(false)
  // A server render and the hydration read `false`, so both show the same placeholder.
  const browser = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )
  const Content = demos[name]
  const load = loaders[name]
  if (!Content || !load) throw new Error(`Missing demo: ${name}`)

  const command = source && `pnpx gitpick ${repository}/tree/main/${source}`
  const loading = (
    <span aria-label={`Loading the demo ${title}`} data-demo-spinner="" />
  )

  return (
    <section aria-label={`Demo: ${title}`} data-demo="">
      <header data-demo-header="">
        <span data-demo-title="">{title}</span>
        <span data-demo-badge="">Demo</span>
        <button
          aria-label={`Reset the demo ${title}`}
          data-demo-icon-button=""
          data-demo-reset=""
          disabled={resetting}
          onClick={() => {
            const mount = () => {
              setResetting(false)
              setEpoch((epoch) => epoch + 1)
            }

            setResetting(true)
            // A sign-out empties the session before its revocation, so a failed one still resets
            // the demo. Both handlers settle the promise.
            void load()
              .then((module) => module.accounts?.signOut())
              .then(mount, mount)
          }}
          title="Reset"
          type="button"
        >
          <Icon name="reset" />
        </button>
      </header>
      <div data-demo-body="">
        {/* A sign-out empties the session before it resolves, so the frame hides the demo for the reset. */}
        {browser && !resetting ? (
          <Suspense fallback={loading}>
            <Content key={epoch} />
          </Suspense>
        ) : (
          loading
        )}
      </div>
      {source && command && (
        <footer data-demo-footer="">
          <code data-demo-command="">{command}</code>
          <Copy
            label="Copy the command that copies the source"
            value={command}
          />
          <a
            data-demo-source=""
            href={`https://github.com/${repository}/tree/main/${source}`}
            rel="noreferrer"
            target="_blank"
          >
            Source
            <Icon name="external" />
          </a>
        </footer>
      )}
    </section>
  )
}

export declare namespace Demo {
  /** Properties for the Demo component. */
  type Props = {
    /** Name of the demo, the file name of its module in `src/demos/` without the extension. */
    name: string
    /**
     * Repository path of the example that holds the demo's code, such as `examples/web`. Without
     * it, the frame shows no footer.
     */
    source?: string | undefined
    /** Title of the frame. */
    title: string
  }
}

/**
 * Shows one step of a demo as a row: its number, its label, and its control. A demo renders its
 * steps in order, and marks the one that the user takes next as `active`.
 *
 * @example
 * ```tsx
 * import { DemoButton, DemoStep } from '../components/Demo.tsx'
 *
 * <DemoStep label="Sign in with Tempo ID." number={1} state="active">
 *   <DemoButton onClick={signIn}>Sign in</DemoButton>
 * </DemoStep>
 * ```
 */
export function DemoStep(props: DemoStep.Props) {
  const { children, detail, label, number, state } = props

  return (
    <div data-demo-step="" data-state={state}>
      <span aria-hidden="true" data-demo-step-number="">
        {state === 'done' ? <Icon name="check" /> : number}
      </span>
      <div data-demo-step-text="">
        <span data-demo-step-label="">{label}</span>
        {detail && <span data-demo-step-detail="">{detail}</span>}
      </div>
      {children && <div data-demo-step-action="">{children}</div>}
    </div>
  )
}

export declare namespace DemoStep {
  /** Properties for the DemoStep component. */
  type Props = {
    /** Control of the step, such as a `DemoButton`. */
    children?: ReactNode | undefined
    /** Result or failure of the step, under its label. */
    detail?: ReactNode | undefined
    /** What the step does, as one sentence. */
    label: ReactNode
    /** Position of the step, from 1. */
    number: number
    /** Whether the step waits for an earlier one, is the next one, or is complete. */
    state: 'active' | 'done' | 'idle'
  }
}

/**
 * Shows the control of a demo's step. While `loading`, it shows a spinner, and takes no click.
 *
 * @example
 * ```tsx
 * import { DemoButton } from '../components/Demo.tsx'
 *
 * <DemoButton loading={pending} onClick={() => send()}>Send</DemoButton>
 * ```
 */
export function DemoButton(props: DemoButton.Props) {
  const { children, disabled, loading, onClick } = props

  return (
    <button
      aria-busy={loading}
      data-demo-button=""
      disabled={disabled || loading}
      onClick={onClick}
      type="button"
    >
      {loading && <span aria-hidden="true" data-demo-spinner="" />}
      {children}
    </button>
  )
}

export declare namespace DemoButton {
  /** Properties for the DemoButton component. */
  type Props = {
    /** Label of the control. */
    children: ReactNode
    /** Whether the control takes no click, such as before its step. Defaults to `false`. */
    disabled?: boolean | undefined
    /** Whether the control's action runs. Defaults to `false`. */
    loading?: boolean | undefined
    /** Runs the control's action. */
    onClick: () => void
  }
}

/** Copies `value`, and shows a check for two seconds after the copy. */
function Copy(props: Copy.Props) {
  const { label, value } = props
  const [copied, setCopied] = useState(false)

  return (
    <button
      aria-label={label}
      data-demo-icon-button=""
      onClick={() => {
        // A refused copy shows no check. Both handlers settle the promise.
        void navigator.clipboard.writeText(value).then(
          () => {
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          },
          () => {},
        )
      }}
      type="button"
    >
      <Icon name={copied ? 'check' : 'copy'} />
    </button>
  )
}

declare namespace Copy {
  /** Properties for the Copy component. */
  type Props = {
    /** Accessible name of the control. */
    label: string
    /** Text to copy. */
    value: string
  }
}

/** Path data of each icon, on a 24 by 24 grid, drawn as a stroke. */
const icons = {
  check: 'M20 6 9 17l-5-5',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  external: 'M15 3h6v6M10 14 21 3M18 13v8H3V6h8',
  reset: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
} as const

/** Draws the icon of `name` at the size of the text. */
function Icon(props: Icon.Props) {
  const { name } = props

  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="1em"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="1em"
    >
      <path d={icons[name]} />
    </svg>
  )
}

declare namespace Icon {
  /** Properties for the Icon component. */
  type Props = {
    /** Name of the icon. */
    name: keyof typeof icons
  }
}

/** Subscribes to nothing, since a page stays in a browser. */
function subscribe() {
  return () => {}
}
