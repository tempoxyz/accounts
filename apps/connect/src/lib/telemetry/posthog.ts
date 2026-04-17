import posthog from 'posthog-js'

const appId = 'connect'
const key = import.meta.env.VITE_POSTHOG_KEY

let initialized = false

/** Initializes PostHog analytics when configured. */
export function init() {
  if (initialized || import.meta.env.DEV || typeof window === 'undefined' || !key) return

  posthog.init(key, {
    api_host: '/pho',
		ui_host: 'https://us.posthog.com',
    autocapture: true,
    capture_pageleave: true,
    capture_pageview: true,
    person_profiles: 'identified_only',
  })

  posthog.register({ tempo_app_id: appId })

  initialized = true
}

/** Identifies the current wallet or account in PostHog. */
export function identify(address: string) {
  init()
  if (!initialized) return
  posthog.identify(address.toLowerCase(), { address: address.toLowerCase() })
}

/** Captures a PostHog event when analytics are enabled. */
export function capture(event: string, properties?: Record<string, unknown> | undefined) {
  init()
  if (!initialized) return
  posthog.capture(event, properties)
}

/** Clears the current PostHog identity. */
export function reset() {
  if (!initialized) return
  posthog.reset()
}
