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
