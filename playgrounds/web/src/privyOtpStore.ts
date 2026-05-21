import type Privy from '@privy-io/js-sdk-core'
import { useSyncExternalStore } from 'react'

/** Options for requesting an email OTP auth ceremony. */
export type PrivyEmailOtpOptions = {
  /** Privy client that will perform OTP requests. */
  client: Privy['auth']
}

/** Active email OTP request rendered by the playground UI. */
export type PrivyEmailOtpRequest = PrivyEmailOtpOptions & {
  /** Rejects the pending adapter request. */
  reject: (error: Error) => void
  /** Resolves the pending adapter request after successful auth. */
  resolve: () => void
}

let request: PrivyEmailOtpRequest | undefined
const listeners = new Set<() => void>()

/** Returns the active email OTP request for React rendering. */
export function usePrivyEmailOtpRequest() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Request an email OTP ceremony from the React playground UI. */
export function requestPrivyEmailOtp(options: PrivyEmailOtpOptions) {
  if (request) request.reject(new Error('Another Privy email OTP request is already active.'))

  return new Promise<void>((resolve, reject) => {
    request = {
      ...options,
      reject,
      resolve,
    }
    emit()
  })
}

/** Resolve and clear the active email OTP request. */
export function resolvePrivyEmailOtp() {
  request?.resolve()
  request = undefined
  emit()
}

/** Reject and clear the active email OTP request. */
export function rejectPrivyEmailOtp(error: Error) {
  request?.reject(error)
  request = undefined
  emit()
}

function emit() {
  for (const listener of listeners) listener()
}

function getSnapshot() {
  return request
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
