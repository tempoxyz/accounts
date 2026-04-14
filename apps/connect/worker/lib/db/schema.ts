import { eq } from 'drizzle-orm'
import { pgTable, index } from 'drizzle-orm/pg-core'

export const users = pgTable('users', (t) => ({
  id: t.text('id').primaryKey(),
  email: t.text('email').notNull().unique(),
  createdAt: t.timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: t.timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}))

export const wallets = pgTable(
  'wallets',
  (t) => ({
    id: t.text('id').primaryKey(),
    userId: t
      .text('user_id')
      .notNull()
      .references(() => users.id),
    credentialId: t.text('credential_id').notNull().unique(),
    publicKey: t.text('public_key').notNull(),
    publicKeyHex: t.text('public_key_hex').notNull(),
    transports: t.text('transports'),
    label: t.text('label').notNull(),
    address: t.text('address').notNull().unique(),
    createdAt: t.timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: t.timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [index('idx_wallets_user_id').on(t.userId)],
)

export { eq }
