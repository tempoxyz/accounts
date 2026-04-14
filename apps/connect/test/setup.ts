import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import fs from 'node:fs'
import path from 'node:path'
import postgres from 'postgres'
import { GenericContainer, Wait } from 'testcontainers'
import type { StartedTestContainer } from 'testcontainers'

let container: StartedTestContainer

export async function setup() {
  const envPath = path.resolve(import.meta.dirname, '../.env')
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/)
    if (match) process.env[match[1]!.trim()] ??= match[2]!.trim()
  }

  container = await new GenericContainer('postgres:16-alpine')
    .withEnvironment({
      POSTGRES_USER: 'tempo',
      POSTGRES_PASSWORD: 'tempo',
      POSTGRES_DB: 'tempo_test',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
    .start()

  const port = container.getMappedPort(5432)
  const host = container.getHost()
  const url = `postgres://tempo:tempo@${host}:${port}/tempo_test`

  const sql = postgres(url, { max: 1 })
  await migrate(drizzle(sql), {
    migrationsFolder: path.resolve(import.meta.dirname, '../migrations'),
  })
  await sql.end()

  process.env.DATABASE_URL = url
}

export async function teardown() {
  await container?.stop()
}
