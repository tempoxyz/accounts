/**
 * The layout components that the React browser playgrounds share: the page with its stylesheet, a
 * titled section, and an inline row of controls. Each page that imports it loads `style.css`.
 * @module
 */
import type { ReactNode } from 'react'
import * as Chain from './Chain.tsx'
import './style.css'

/** The page's centered column, with the playgrounds' stylesheet, and the network's toggle beside the title. */
export function Page(props: Page.Props) {
  return (
    <main>
      <header>
        <div className="title">
          <h1>{props.title}</h1>
          <Chain.Toggle />
        </div>
        {props.description ? (
          <p className="muted">{props.description}</p>
        ) : null}
      </header>
      {props.children}
    </main>
  )
}

export declare namespace Page {
  type Props = {
    /** The page's sections. */
    children: ReactNode
    /** One sentence below the title on what the playground shows. Absent for none. */
    description?: string | undefined
    /** The playground's name. */
    title: string
  }
}

/** A titled card of the page. */
export function Section(props: Section.Props) {
  return (
    <section aria-labelledby={props.id}>
      <header>
        <h2 id={props.id}>{props.title}</h2>
        {props.description ? (
          <p className="muted">{props.description}</p>
        ) : null}
      </header>
      {props.children}
    </section>
  )
}

export declare namespace Section {
  type Props = {
    /** The section's content. */
    children: ReactNode
    /** One sentence below the title on what the section does. Absent for none. */
    description?: ReactNode | undefined
    /** The heading's ID, which names the section's landmark. */
    id: string
    /** The heading. */
    title: string
  }
}

/** An inline, wrapping row of buttons and fields. */
export function Row(props: Row.Props) {
  return <div className="row">{props.children}</div>
}

export declare namespace Row {
  type Props = {
    /** The row's controls. */
    children: ReactNode
  }
}
