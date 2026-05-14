'use client'

import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'
import { Button } from 'regen-ui'
import LucideRotateCcw from '~icons/lucide/rotate-ccw'

type Action = number | 'next' | 'back' | 'reset'

type StepsContextValue = {
  current: number
  set: (action: Action) => void
}

const StepsContext = createContext<StepsContextValue | null>(null)
const StepContext = createContext<number | null>(null)

/**
 * Wraps children with step state. Auto-numbers any direct {@link Step}
 * children starting at 1; pass `value` on a `<Step>` to override. `initial`
 * defaults to the first inferred step (1) so the first row is active.
 *
 * Renders without any layout wrapper. Use {@link Root} for the default
 * vertically-stacked layout.
 *
 * Reads via {@link use}.
 */
export function Provider(props: Provider.Props) {
  const { children, initial } = props
  const { enriched, value } = useStepsState(children, initial)
  return <StepsContext.Provider value={value}>{enriched}</StepsContext.Provider>
}

export declare namespace Provider {
  type Props = {
    children: ReactNode
    /** Starting step. @default first inferred step (`1`) */
    initial?: number
  }
}

/**
 * Convenience wrapper around {@link Provider} that lays steps out in a
 * vertical stack with consistent gap.
 */
export function Root(props: Root.Props) {
  const { children, initial } = props
  const { enriched, value } = useStepsState(children, initial)
  return (
    <StepsContext.Provider value={value}>
      <div className="flex flex-col gap-3">{enriched}</div>
    </StepsContext.Provider>
  )
}

export declare namespace Root {
  type Props = Provider.Props
}

/**
 * Recursively walks `children`, assigning sequential `value` props to any
 * {@link Step} elements found anywhere in the subtree. Wrappers (any
 * non-Step element) are cloned with their walked children, so Steps inside
 * arbitrary wrappers (e.g. a {@link Demo}) still get auto-numbered.
 */
function enrichSteps(
  children: ReactNode,
  counter: { value: number },
  first: { value: number | undefined },
): ReactNode {
  return Children.map(children, (child) => {
    if (!isValidElement(child)) return child
    const isStep =
      typeof child.type === 'function' && (child.type as { __step?: boolean }).__step === true
    if (isStep) {
      counter.value += 1
      const childProps = child.props as Step.Props
      const value = childProps.value ?? counter.value
      if (first.value === undefined) first.value = value
      return cloneElement(child as ReactElement<Step.Props>, { key: value, value })
    }
    const childProps = child.props as { children?: ReactNode }
    if (childProps.children === undefined) return child
    return cloneElement(child, {
      children: enrichSteps(childProps.children, counter, first),
    } as never)
  })
}

function useStepsState(children: ReactNode, initial: number | undefined) {
  const { enriched, firstValue } = useMemo(() => {
    const counter = { value: 0 }
    const first: { value: number | undefined } = { value: undefined }
    const enriched = enrichSteps(children, counter, first)
    return { enriched, firstValue: first.value ?? 1 }
  }, [children])

  const [current, _setStep] = useState(initial ?? firstValue)

  const set = useCallback(
    (action: Action) => {
      if (action === 'next') _setStep((s) => s + 1)
      else if (action === 'back') _setStep((s) => Math.max(0, s - 1))
      else if (action === 'reset') _setStep(initial ?? firstValue)
      else _setStep(action)
    },
    [initial, firstValue],
  )

  const value = useMemo<StepsContextValue>(() => ({ current, set }), [current, set])
  return { enriched, value }
}

/**
 * Returns `{ active, current, set }`. `active` is `true` only when called
 * inside a {@link Step} that matches the current step. `set` accepts a step
 * index (`number`), or one of `'next'`, `'back'`, `'reset'`.
 *
 * @example
 * ```ts
 * import * as Steps from './Steps'
 *
 * const { active, current, set } = Steps.use()
 * set('next')
 * ```
 */
export function use(): { active: boolean; current: number; set: (action: Action) => void } {
  const ctx = useContext(StepsContext)
  if (!ctx) throw new Error('Steps.use() must be called inside <Steps.Provider>')
  const stepValue = useContext(StepContext)
  return {
    active: stepValue !== null && stepValue === ctx.current,
    current: ctx.current,
    set: ctx.set,
  }
}

/**
 * A single row in a step list. Clicking the action button advances to the
 * next step by default; wrap with a client component if you need a custom
 * handler.
 */
export function Step(props: Step.Props) {
  const { action, children, label, value } = props
  const ctx = useContext(StepsContext)
  if (!ctx) throw new Error('<Steps.Step> must be inside <Steps.Provider>')
  if (value === undefined)
    throw new Error('<Steps.Step> must have a `value` (set automatically by <Steps.Provider>)')
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
          ) : (action ?? null)}
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

/**
 * Marker so {@link enrichSteps} can recognize Step elements without relying
 * on identity comparison (which breaks across HMR or MDX component
 * wrapping).
 */
;(Step as unknown as { __step: boolean }).__step = true

export declare namespace Step {
  type Props = {
    /**
     * Step index this row represents. Auto-assigned by the parent
     * {@link Provider} based on the child's position; only set explicitly
     * to override.
     */
    value?: number
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


