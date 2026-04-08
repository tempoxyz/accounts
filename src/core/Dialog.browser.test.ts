import { afterEach, describe, expect, test, vi } from 'vp/test'

import * as Dialog from './Dialog.js'
import * as Storage from './Storage.js'
import * as Store from './Store.js'

const host = 'https://wallet.tempo.xyz/embed'

function setup() {
  const store = Store.create({
    chainId: 1,
    storage: Storage.memory({ key: 'dialog-test' }),
  })
  const dialog = Dialog.iframe()
  const handle = dialog({ host, store })
  return { handle, store }
}

afterEach(() => {
  document.querySelectorAll('dialog[data-tempo-wallet]').forEach((el) => el.remove())
  document.body.style.overflow = ''
})

describe('Dialog.iframe', () => {
  test('default: appends dialog and iframe to document.body', () => {
    setup()
    const dialog = document.querySelector('dialog[data-tempo-wallet]')
    expect(dialog).not.toBeNull()
    const iframe = dialog!.querySelector('iframe')
    expect(iframe).not.toBeNull()
  })

  test('behavior: multiple calls tear down previous — no duplicate iframes', () => {
    setup()
    setup()
    setup()
    const dialogs = document.querySelectorAll('dialog[data-tempo-wallet]')
    expect(dialogs.length).toBe(1)
  })

  test('behavior: iframe has correct sandbox attributes', () => {
    setup()
    const iframe = document.querySelector('dialog[data-tempo-wallet] iframe')!
    expect(iframe.getAttribute('sandbox')).toMatchInlineSnapshot(
      `"allow-forms allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"`,
    )
  })

  test('behavior: iframe has correct allow attributes', () => {
    setup()
    const iframe = document.querySelector('dialog[data-tempo-wallet] iframe')!
    const allow = iframe.getAttribute('allow')!
    expect(allow).toContain('publickey-credentials-get')
    expect(allow).toContain('publickey-credentials-create')
  })

  test('behavior: iframe src points to host', () => {
    setup()
    const iframe = document.querySelector('dialog[data-tempo-wallet] iframe') as HTMLIFrameElement
    expect(iframe.src).toMatchInlineSnapshot(`"https://wallet.tempo.xyz/embed/"`)
    expect(iframe.src).toContain(host)
  })

  test('behavior: open shows dialog', () => {
    const { handle } = setup()
    handle.open()
    const dialog = document.querySelector('dialog[data-tempo-wallet]') as HTMLDialogElement
    expect(dialog.open).toBe(true)
  })

  test('behavior: close hides dialog', () => {
    const { handle } = setup()
    handle.open()
    handle.close()
    const dialog = document.querySelector('dialog[data-tempo-wallet]') as HTMLDialogElement
    expect(dialog.open).toBe(false)
  })

  test('behavior: destroy removes dialog from DOM', () => {
    const { handle } = setup()
    handle.destroy()
    expect(document.querySelector('dialog[data-tempo-wallet]')).toBeNull()
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

  test('behavior: open is idempotent', () => {
    const { handle } = setup()
    handle.open()
    expect(() => handle.open()).not.toThrow()
    const dialog = document.querySelector('dialog[data-tempo-wallet]') as HTMLDialogElement
    expect(dialog.open).toBe(true)
    handle.close()
  })

  test('behavior: close without open does not throw', () => {
    const { handle } = setup()
    expect(() => handle.close()).not.toThrow()
  })

  test('behavior: destroy restores body scroll', () => {
    const { handle } = setup()
    document.body.style.overflow = 'auto'
    handle.open()
    handle.destroy()
    expect(document.body.style.overflow).toBe('auto')
  })

  test('behavior: destroy closes open dialog', () => {
    const { handle } = setup()
    handle.open()
    handle.destroy()
    expect(document.querySelector('dialog[data-tempo-wallet]')).toBeNull()
  })

  test('behavior: cancel event rejects pending requests', () => {
    const { handle, store } = setup()
    handle.open()
    const dialog = document.querySelector('dialog[data-tempo-wallet]') as HTMLDialogElement
    dialog.dispatchEvent(new Event('cancel'))
    const queue = store.getState().requestQueue
    for (const q of queue) expect(q.status).toBe('error')
  })

  test('behavior: focus restored to previous element on close', () => {
    const button = document.createElement('button')
    document.body.appendChild(button)
    button.focus()
    expect(document.activeElement).toBe(button)

    const { handle } = setup()
    handle.open()
    handle.close()

    expect(document.activeElement).toBe(button)
    button.remove()
  })

  test('behavior: backdrop click rejects pending requests', () => {
    const { handle, store } = setup()
    handle.open()
    const dialog = document.querySelector('dialog[data-tempo-wallet]') as HTMLDialogElement

    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    const queue = store.getState().requestQueue
    for (const q of queue) expect(q.status).toBe('error')
  })

  test('behavior: click inside iframe does not close dialog', () => {
    const { handle } = setup()
    handle.open()
    const dialog = document.querySelector('dialog[data-tempo-wallet]') as HTMLDialogElement
    const iframe = dialog.querySelector('iframe')!

    iframe.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(dialog.open).toBe(true)
  })

  test('behavior: 1Password inert attribute stripped from dialog', async () => {
    const { handle } = setup()
    handle.open()
    const dialog = document.querySelector('dialog[data-tempo-wallet]') as HTMLDialogElement

    dialog.setAttribute('inert', '')

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(dialog.hasAttribute('inert')).toBe(false)
    handle.close()
  })

  test('behavior: iframe has accessibility attributes', () => {
    setup()
    const dialog = document.querySelector('dialog[data-tempo-wallet]') as HTMLDialogElement
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.getAttribute('aria-label')).toBe('Tempo Auth')
  })
})

describe('Dialog.popup', () => {
  test('default: window.open called with correct URL', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({
      closed: false,
      close: vi.fn(),
    } as unknown as Window)

    const store = Store.create({
      chainId: 1,
      storage: Storage.memory({ key: 'popup-test' }),
    })
    const dialog = Dialog.popup()
    const handle = dialog({ host, store })
    handle.open()

    expect(openSpy).toHaveBeenCalledOnce()
    expect(openSpy.mock.calls[0]![0]).toBe(host)

    handle.destroy()
    openSpy.mockRestore()
  })

  test('behavior: window.open called with centered position', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({
      closed: false,
      close: vi.fn(),
    } as unknown as Window)

    const store = Store.create({
      chainId: 1,
      storage: Storage.memory({ key: 'popup-test' }),
    })
    const dialog = Dialog.popup()
    const handle = dialog({ host, store })
    handle.open()

    const features = openSpy.mock.calls[0]![2] as string
    expect(features).toContain('width=')
    expect(features).toContain('height=')
    expect(features).toContain('left=')
    expect(features).toContain('top=')

    handle.destroy()
    openSpy.mockRestore()
  })

  test('behavior: close calls popup.close()', () => {
    const popupClose = vi.fn()
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({
      closed: false,
      close: popupClose,
    } as unknown as Window)

    const store = Store.create({
      chainId: 1,
      storage: Storage.memory({ key: 'popup-test' }),
    })
    const dialog = Dialog.popup()
    const handle = dialog({ host, store })
    handle.open()
    handle.close()

    expect(popupClose).toHaveBeenCalledOnce()

    handle.destroy()
    openSpy.mockRestore()
  })

  test('behavior: open throws if popup blocked', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)

    const store = Store.create({
      chainId: 1,
      storage: Storage.memory({ key: 'popup-test' }),
    })
    const dialog = Dialog.popup()
    const handle = dialog({ host, store })

    expect(() => handle.open()).toThrow('Failed to open popup')

    openSpy.mockRestore()
  })

  test('behavior: destroy cleans up', () => {
    const popupClose = vi.fn()
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({
      closed: false,
      close: popupClose,
    } as unknown as Window)

    const store = Store.create({
      chainId: 1,
      storage: Storage.memory({ key: 'popup-test' }),
    })
    const dialog = Dialog.popup()
    const handle = dialog({ host, store })
    handle.open()
    handle.destroy()

    expect(popupClose).toHaveBeenCalled()

    openSpy.mockRestore()
  })
})

describe('Dialog.noop', () => {
  test('default: open, close, destroy are callable without error', () => {
    const store = Store.create({
      chainId: 1,
      storage: Storage.memory({ key: 'noop-test' }),
    })
    const dialog = Dialog.noop()
    const handle = dialog({ host, store })
    expect(() => handle.open()).not.toThrow()
    expect(() => handle.close()).not.toThrow()
    expect(() => handle.destroy()).not.toThrow()
  })
})

describe('isSafari', () => {
  test('default: returns false in non-Safari environment', () => {
    expect(Dialog.isSafari()).toBe(false)
  })
})
