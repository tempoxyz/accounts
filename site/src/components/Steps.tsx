'use client'

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Button } from 'regen-ui'
import LucideRotateCcw from '~icons/lucide/rotate-ccw'

type Action = number | 'next' | 'back' | 'reset'

type StepsContextValue = {
  current: number
  set: (action: Action) => void
  /**
   * Claim a sequential 1-based slot for a Step by its stable `id`. Repeat
   * calls with the same id (e.g. from React strict-mode double-renders)
   * return the same value without shifting subsequent steps.
   */
  register: (id: string) => number
}

const StepsContext = createContext<StepsContextValue | null>(null)
const StepContext = createContext<number | null>(null)

/**
 * Wraps children with step state. Each {@link Step} that renders without an
 * explicit `value` is auto-numbered sequentially, starting at 1, in the
 * order it is rendered. `initial` defaults to `1`.
 *
 * Renders without any layout wrapper. Use {@link Root} for the default
 * vertically-stacked layout.
 *
 * Reads via {@link use}.
 */
export function Provider(props: Provider.Props) {
  const { children, initial } = props
  return <StepsRoot initial={initial}>{children}</StepsRoot>
}

export declare namespace Provider {
  type Props = {
    children: ReactNode
    /** Starting step. @default `1` */
    initial?: number
  }
}

/**
 * Convenience wrapper around {@link Provider} that lays steps out in a
 * vertical stack with consistent gap.
 */
export function Root(props: Root.Props) {
  const { children, initial } = props
  return (
    <StepsRoot initial={initial}>
      <div className="flex flex-col gap-3">{children}</div>
    </StepsRoot>
  )
}

export declare namespace Root {
  type Props = Provider.Props
}

function StepsRoot(props: { children: ReactNode; initial: number | undefined }) {
  const { children, initial } = props
  // Stable ordered list of Step ids that have registered with this
  // Provider. Lives in a ref so the slot a Step claims survives across
  // re-renders and React's strict-mode double-invocation.
  const idsRef = useRef<string[]>([])

  const [current, setStep] = useState(initial ?? 1)

  const set = useCallback(
    (action: Action) => {
      if (action === 'next') setStep((s) => s + 1)
      else if (action === 'back') setStep((s) => Math.max(0, s - 1))
      else if (action === 'reset') setStep(initial ?? 1)
      else setStep(action)
    },
    [initial],
  )

  const register = useCallback((id: string) => {
    const ids = idsRef.current
    const i = ids.indexOf(id)
    if (i !== -1) return i + 1
    ids.push(id)
    return ids.length
  }, [])

  const value = useMemo<StepsContextValue>(
    () => ({ current, set, register }),
    [current, set, register],
  )
  return <StepsContext.Provider value={value}>{children}</StepsContext.Provider>
}

/**
 * Returns `{ active, current, set }`. `set` accepts a step index
 * (`number`), or one of `'next'`, `'back'`, `'reset'`.
 *
 * `active` is `true` when the surrounding step matches `current`. The step
 * to compare against is resolved as follows:
 *
 *   1. If `value` is passed, compare against it (useful when calling from
 *      outside a `<Step>`, e.g. a composite component that owns its own
 *      `<Step>` element).
 *   2. Otherwise, use the nearest `<Step>` ancestor's value.
 *   3. If neither is present, `active` is always `false`.
 *
 * @example
 * ```ts
 * import * as Steps from './Steps'
 *
 * const steps = Steps.use(2)
 * if (steps.active) steps.set('next')
 * ```
 */
export function use(value?: number): {
  active: boolean
  current: number
  set: (action: Action) => void
} {
  const ctx = useContext(StepsContext)
  if (!ctx) throw new Error('Steps.use() must be called inside <Steps.Provider>')
  const stepValue = useContext(StepContext)
  const compare = value ?? stepValue
  return {
    active: compare !== null && compare !== undefined && compare === ctx.current,
    current: ctx.current,
    set: ctx.set,
  }
}

/**
 * Claim a sequential 1-based step slot in the surrounding {@link Provider}
 * and report active state, all in one call. Use this from a composite
 * component that owns its own {@link Step}: pass `value` down and read
 * `active` for the action button without nesting another component.
 *
 * @example
 * ```tsx
 * function SendPayment() {
 *   const steps = Steps.useStep()
 *   return <Steps.Step value={steps.value} ...action={... disabled={!steps.active} />} />
 * }
 * ```
 */
export function useStep(): {
  active: boolean
  value: number
  current: number
  set: (action: Action) => void
} {
  const ctx = useContext(StepsContext)
  if (!ctx) throw new Error('Steps.useStep() must be called inside <Steps.Provider>')
  const id = useId()
  const value = ctx.register(id)
  return {
    active: ctx.current === value,
    value,
    current: ctx.current,
    set: ctx.set,
  }
}

/**
 * A single row in a step list. Auto-numbers in render order via
 * {@link Provider}; pass `value` only to override.
 *
 * Clicking the action button advances to the next step by default; wrap
 * with a client component if you need a custom handler.
 */
export function Step(props: Step.Props) {
  const { action, children, label } = props
  const ctx = useContext(StepsContext)
  if (!ctx) throw new Error('<Steps.Step> must be inside <Steps.Provider>')
  // If `value` is omitted, claim a stable slot from the surrounding
  // Provider keyed by `useId()`. Strict-mode double-invocation of the Step
  // body is safe because `register` is idempotent per id.
  const id = useId()
  const value = props.value ?? ctx.register(id)
  const active = ctx.current === value

  return (
    <StepContext.Provider value={value}>
      <div
        className={`flex flex-col gap-3 transition-opacity ${active ? '' : 'opacity-50'}`}
        data-active={active || undefined}
      >
        <div className="flex items-center gap-4">
          <div className="flex shrink-0 size-7 items-center justify-center border border-primary text-secondary text-[13px]">
            {value}
          </div>
          <div className="flex-1 text-primary text-[14px]">{label}</div>
          {typeof action === 'string' ? (
            <Button
              variant={active ? 'primary' : 'secondary'}
              onClick={() => ctx.set(value + 1)}
              disabled={!active}
              data-active={active || undefined}
            >
              {action}
            </Button>
          ) : (
            (action ?? null)
          )}
        </div>
        {children && active ? (
          <div className="ml-11 border-l border-primary pl-4 text-primary text-[14px]">
            {children}
          </div>
        ) : null}
      </div>
    </StepContext.Provider>
  )
}

export declare namespace Step {
  type Props = {
    /**
     * Step index this row represents. Auto-assigned by the surrounding
     * {@link Provider} based on render order; only set explicitly to
     * override.
     */
    value?: number | undefined
    /** Description text shown next to the number. */
    label: ReactNode
    /**
     * Optional action element. When a string, renders the default
     * step-advancing primary/secondary button with that label. When a
     * `ReactNode`, renders it as-is so callers can supply a custom
     * action (e.g. a wagmi-driven connect button).
     */
    action?: ReactNode | undefined
    /** Optional body content rendered below the row, indented under the label. */
    children?: ReactNode
  }
}

/**
 * Icon button that resets the surrounding {@link Provider} to its initial
 * step. Intended for placement in surfaces like a {@link Demo} header.
 */
export function Reset() {
  const { set } = use()
  return (
    <button
      type="button"
      aria-label="Restart"
      onClick={() => set('reset')}
      className="text-secondary hover:text-primary flex size-7 items-center justify-center cursor-pointer leading-none"
    >
      <LucideRotateCcw aria-hidden className="size-4 block" />
    </button>
  )
}
