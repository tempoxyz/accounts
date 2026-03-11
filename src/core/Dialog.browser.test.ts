import { afterEach, describe, expect, test } from 'vitest'

import * as Dialog from './Dialog.js'
import * as Messenger from './Messenger.js'

const host = 'https://auth.tempo.xyz'

function setup() {
  const messenger = Messenger.noop()
  const dialog = Dialog.iframe()
  const handle = dialog.setup({ host, messenger })
  return { handle, messenger }
}

afterEach(() => {
  document.querySelectorAll('dialog[data-tempo-connect]').forEach((el) => el.remove())
  document.body.style.overflow = ''
})

describe('Dialog.iframe', () => {
  test('default: appends dialog and iframe to document.body', () => {
    setup()
    const dialog = document.querySelector('dialog[data-tempo-connect]')
    expect(dialog).not.toBeNull()
    const iframe = dialog!.querySelector('iframe')
    expect(iframe).not.toBeNull()
  })

  test('behavior: iframe has correct sandbox attributes', () => {
    setup()
    const iframe = document.querySelector('dialog[data-tempo-connect] iframe')!
    expect(iframe.getAttribute('sandbox')).toMatchInlineSnapshot(
      `"allow-forms allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"`,
    )
  })

  test('behavior: iframe has correct allow attributes', () => {
    setup()
    const iframe = document.querySelector('dialog[data-tempo-connect] iframe')!
    const allow = iframe.getAttribute('allow')!
    expect(allow).toContain('publickey-credentials-get')
    expect(allow).toContain('publickey-credentials-create')
  })

  test('behavior: iframe src points to host', () => {
    setup()
    const iframe = document.querySelector('dialog[data-tempo-connect] iframe') as HTMLIFrameElement
    expect(iframe.src).toMatchInlineSnapshot(`"https://auth.tempo.xyz/"`)
    expect(iframe.src).toContain(host)
  })

  test('behavior: open shows dialog', () => {
    const { handle } = setup()
    handle.open()
    const dialog = document.querySelector('dialog[data-tempo-connect]') as HTMLDialogElement
    expect(dialog.open).toBe(true)
  })

  test('behavior: close hides dialog', () => {
    const { handle } = setup()
    handle.open()
    handle.close()
    const dialog = document.querySelector('dialog[data-tempo-connect]') as HTMLDialogElement
    expect(dialog.open).toBe(false)
  })

  test('behavior: destroy removes dialog from DOM', () => {
    const { handle } = setup()
    handle.destroy()
    expect(document.querySelector('dialog[data-tempo-connect]')).toBeNull()
  })

  test('behavior: body scroll locked on open', () => {
    const { handle } = setup()
    handle.open()
    expect(document.body.style.overflow).toBe('hidden')
  })

  test('behavior: body scroll restored on close', () => {
    const { handle } = setup()
    document.body.style.overflow = 'auto'
    handle.open()
    handle.close()
    expect(document.body.style.overflow).toBe('auto')
  })
})
