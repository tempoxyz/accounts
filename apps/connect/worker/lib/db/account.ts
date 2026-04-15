import { eq } from 'drizzle-orm'
import type { Address } from 'ox'

import type { Instance } from './index.js'
import { accounts } from './schema.js'

/** Returns an account by address. */
export async function getByAddress(db: Instance, address: Address.Address) {
  const [account] = await db.select().from(accounts).where(eq(accounts.address, address))
  return account
}

/** Inserts a new account. */
export async function insert(db: Instance, values: typeof accounts.$inferInsert) {
  const [account] = await db.insert(accounts).values(values).returning()
  return account!
}
