import * as Sentry from '@sentry/react'
import type { ErrorEvent, EventHint } from '@sentry/react'

const appId = 'connect'
const dsn = import.meta.env.VITE_SENTRY_DSN

let initialized = false

/** Adds Connect-specific metadata to browser Sentry events. */
export function beforeSend(event: ErrorEvent, _hint: EventHint): ErrorEvent {
  event.tags = {
    ...event.tags,
    route: typeof window === 'undefined' ? undefined : window.location.pathname,
  }

  return event
}

/** Initializes the browser Sentry client when configured. */
export function init() {
  if (initialized || typeof window === 'undefined' || !dsn) return

  Sentry.init({
    dsn,
    enabled: true,
    environment: import.meta.env.MODE,
    initialScope: {
      tags: {
        tempo_app_id: appId,
        tempo_runtime: 'browser',
      },
    },
    release: __BUILD_VERSION__,
    replaysOnErrorSampleRate: 1,
    replaysSessionSampleRate: 0.1,
    tunnel: '/sentry-tunnel',
    tracesSampleRate: 0.1,
    beforeSend,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        blockAllMedia: true,
        maskAllText: true,
      }),
    ],
  })

  initialized = true
}

/** Reports a browser exception to Sentry when enabled. */
export function captureException(error: unknown) {
  init()
  if (!initialized) return
  Sentry.captureException(error)
}
