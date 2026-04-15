import { eq, sql } from 'drizzle-orm'
import { customType, pgTable, uniqueIndex } from 'drizzle-orm/pg-core'
import { Address, type Hex } from 'ox'

const address = customType<{ data: Address.Address; driverData: Buffer }>({
  dataType() {
    return 'bytea'
  },
  toDriver(value) {
    return Buffer.from(value.slice(2), 'hex')
  },
  fromDriver(value) {
    return Address.from(`0x${value.toString('hex')}` as Hex.Hex)
  },
})

const bytea = customType<{ data: Hex.Hex; driverData: Buffer }>({
  dataType() {
    return 'bytea'
  },
  toDriver(value) {
    return Buffer.from(value.slice(2), 'hex')
  },
  fromDriver(value) {
    return `0x${value.toString('hex')}` as Hex.Hex
  },
})

export const accounts = pgTable(
  'accounts',
  (t) => ({
    address: address('address').primaryKey(),
    email: t.text('email'),
    createdAt: t.timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: t.timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [
    uniqueIndex('idx_accounts_email')
      .on(t.email)
      .where(sql`email IS NOT NULL`),
  ],
)

export const wallets = pgTable('wallets', (t) => ({
  id: t.text('id').primaryKey(),
  credentialId: t.text('credential_id').notNull().unique(),
  publicKey: bytea('public_key').notNull(),
  transports: t.text('transports'),
  username: t.text('username').notNull(),
  label: t.text('label').notNull(),
  address: address('address').notNull().unique(),
  createdAt: t.timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: t.timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}))

export { eq }
