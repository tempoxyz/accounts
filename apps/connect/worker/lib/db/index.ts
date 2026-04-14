import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

/** Creates a per-request database connection. */
export function get(hyperdrive?: Hyperdrive) {
  const url = hyperdrive?.connectionString ?? process.env.DATABASE_URL!
  return drizzle(postgres(url, { prepare: false }))
}

export type Instance = ReturnType<typeof get>
