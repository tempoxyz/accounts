/**
 * Runs `Store.durableObject` in a Durable Object for `src/Store.test.ts`. `POST /` applies one
 * operation, in ox's `Json`, to the object that the request's `name` names.
 * @module
 */
import { Store } from 'accounts'
import { DurableObject } from 'cloudflare:workers'
import { Json } from 'ox'

/** The bindings of the Worker. */
type Bindings = {
  /** The Durable Object of each test. */
  VALUES: Namespace
}

/** The namespace of {@link Values}, as the Worker calls it. */
type Namespace = {
  /** Returns the stub of the object that `name` names. */
  getByName: (name: string) => Pick<Values, 'apply'>
}

/** One operation on the store. */
type Operation =
  | { key: string; op: 'get' }
  | { key: string; op: 'remove' }
  | {
      expiresAt?: number | undefined
      key: string
      op: 'set'
      value: unknown
    }
  | { op: 'alarm' }
  | { op: 'nextAlarm' }

/** Holds the values of one test in `Store.durableObject`. */
export class Values extends DurableObject<Bindings> {
  store = Store.durableObject(this.ctx.storage)

  alarm() {
    return this.store.alarm()
  }

  /** Applies `operation`, and returns its result in ox's `Json`. */
  async apply(body: string) {
    const operation = Json.parse(body) as Operation
    const result = await (async () => {
      if (operation.op === 'get') return this.store.getItem(operation.key)
      if (operation.op === 'remove') return this.store.removeItem(operation.key)
      if (operation.op === 'set')
        return this.store.setItem(operation.key, operation.value, {
          expiresAt: operation.expiresAt,
        })
      if (operation.op === 'alarm') return this.store.alarm()
      return this.ctx.storage.getAlarm()
    })()
    return Json.stringify({ result: result ?? null })
  }
}

export default {
  async fetch(request: Request, env: Bindings) {
    const name = new URL(request.url).searchParams.get('name')
    if (request.method !== 'POST' || !name)
      return new Response(null, { status: 404 })
    return new Response(
      await env.VALUES.getByName(name).apply(await request.text()),
    )
  },
}
