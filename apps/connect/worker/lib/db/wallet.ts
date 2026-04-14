import { eq } from 'drizzle-orm'

import type { Instance } from './index.js'
import { wallets } from './schema.js'

/** Returns all wallets for a user. */
export async function getByUserId(db: Instance, userId: string) {
  return db.select().from(wallets).where(eq(wallets.userId, userId))
}

/** Returns a wallet by credential ID. */
export async function getByCredentialId(db: Instance, credentialId: string) {
  const [wallet] = await db.select().from(wallets).where(eq(wallets.credentialId, credentialId))
  return wallet
}

/** Inserts a new wallet. */
export async function insert(db: Instance, values: typeof wallets.$inferInsert) {
  const [wallet] = await db.insert(wallets).values(values).returning()
  return wallet!
}
