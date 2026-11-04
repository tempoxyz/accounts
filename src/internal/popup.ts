/**
 * The popup window of Tempo ID's pages: its opening, centered on the window, and the callback that
 * its page posts in place of the redirect URI's page. The dialog's fallback, the dialog in popup
 * mode, and the deposit page share it.
 * @module
 */
/* istanbul ignore file -- The popup window exists only in a browser. */
/**
 * Milliseconds that a closed popup has to deliver a callback that its page posted as it closed,
 * before the sign-in counts as closed.
 */
const closeGrace = 1_000

/** Milliseconds between two checks of whether the user closed a popup. */
const closeInterval = 100

/**
 * Opens `url` in a popup centered on the window, or returns `null` when the browser blocks it. Each
 * of Tempo ID's pages in the popup then fits the window's height to its content.
 */
export function openPopup(url: string) {
  // The content column of Tempo ID's pages, 384 pixels, and 24 pixels of padding at each side.
  const width = 432
  // About the height of the sign-in, the first page, so its fit moves the window little.
  const height = 420
  const left = window.screenX + (window.outerWidth - width) / 2
  const top = window.screenY + (window.outerHeight - height) / 2
  return window.open(
    url,
    '_blank',
    `popup,width=${width},height=${height},left=${left},top=${top}`,
  )
}

/**
 * Takes the callback that Tempo ID's page in `popup` posts in place of the redirect URI's page, and
 * calls `onClose` once the user closes the popup. Only a popup whose page reported that it loaded
 * counts as closed, since this page's own `Cross-Origin-Opener-Policy` severs the handle, which then
 * reads as closed while the popup is open. `onClosed` runs as soon as the popup reads closed, and
 * `onClose` waits `closeGrace` more for a callback that the popup posted as it closed. Returns the
 * function that stops both.
 */
export function watchPopup(popup: Window, options: watchPopup.Options) {
  let open = false
  let closedAt: number | undefined
  const listener = (event: MessageEvent) => {
    if (event.origin !== options.origin || event.source !== popup) return
    const data = event.data as { type?: unknown; url?: unknown } | null
    if (data?.type === 'tempo-id:popup.open') open = true
    else if (
      data?.type === 'tempo-id:popup.callback' &&
      typeof data.url === 'string'
    ) {
      stop()
      options.onCallback(data.url)
    }
  }
  const interval = setInterval(() => {
    if (!open || !popup.closed) return
    if (closedAt === undefined) {
      closedAt = Date.now()
      options.onClosed?.()
    }
    if (Date.now() - closedAt < closeGrace) return
    stop()
    options.onClose()
  }, closeInterval)
  const stop = () => {
    clearInterval(interval)
    window.removeEventListener('message', listener)
  }
  window.addEventListener('message', listener)
  return stop
}

export declare namespace watchPopup {
  type Options = {
    /** Runs with the callback URL, the redirect URI with `code` and `state`, or with `error`. */
    onCallback: (url: string) => void
    /** Runs once the user closes the popup, after `closeGrace` without a callback. */
    onClose: () => void
    /**
     * Runs as soon as the popup reads closed, before `closeGrace`, such as to remove a dialog that
     * names the window. A callback can still arrive after it.
     */
    onClosed?: (() => void) | undefined
    /** Tempo ID's origin, whose page in the popup posts the messages. */
    origin: string
  }
}

/**
 * Returns whether the page runs on iOS or iPadOS, whose deposit page opens in a popup in place of a
 * frame. iPadOS Safari reports a Mac, so a Mac with a touch screen counts as an iPad.
 */
export function apple() {
  const agent = navigator.userAgent
  if (/iPad|iPhone|iPod/.test(agent)) return true
  return /Macintosh/.test(agent) && navigator.maxTouchPoints > 1
}

/**
 * Returns whether the page holds a user gesture, within which a popup blocker accepts `window.open`.
 * A browser without `navigator.userActivation` counts as holding one, so its call opens the popup.
 */
export function activated() {
  return navigator.userActivation?.isActive ?? true
}
