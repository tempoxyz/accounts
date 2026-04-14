import { eq } from 'drizzle-orm'

import type { Instance } from './index.js'
import { users } from './schema.js'

/** Upserts a user by email. Returns the user id. */
export async function upsert(db: Instance, email: string) {
  const [user] = await db
    .insert(users)
    .values({ id: crypto.randomUUID(), email })
    .onConflictDoUpdate({ target: users.email, set: { updatedAt: new Date() } })
    .returning({ id: users.id })
  return user!
}

/** Looks up a user's email by their id. Returns `undefined` if not found. */
export async function getEmail(db: Instance, userId: string) {
  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return user?.email
}
