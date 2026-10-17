import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = join(import.meta.dirname, '..')

/** Returns an importable URL for a module under the repository root. */
export function moduleUrl(path: string): string {
  return pathToFileURL(join(root, path)).href
}

/** Starts a Node process running the ES module `script`, which may import TypeScript sources. */
export function run(script: string) {
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk))
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    child.once('exit', (code, signal) => resolve({ code, signal })),
  )

  return {
    exited,
    pid: child.pid!,
    get stderr() {
      return stderr
    },
    /** Kills the process with `SIGKILL` and waits for it to exit. */
    async kill() {
      child.kill('SIGKILL')
      return await exited
    },
    /** Writes a line to the process's stdin. */
    send(line: string) {
      child.stdin.write(`${line}\n`)
    },
    /** Resolves once the process has printed `line`, or rejects if it exits first. */
    async waitFor(line: string) {
      await new Promise<void>((resolve, reject) => {
        const check = () => {
          if (!stdout.split('\n').includes(line)) return
          child.stdout.off('data', check)
          resolve()
        }
        child.stdout.on('data', check)
        void exited.then(() => reject(new Error(`Process exited before "${line}": ${stderr}`)))
        check()
      })
    },
  }
}
