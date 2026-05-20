import type { CreateSubOrgParams, TurnkeyClientMethods } from '@turnkey/core'
import { useSyncExternalStore } from 'react'

/** Minimal Turnkey client surface used by the playground email OTP UI. */
export type TurnkeyEmailOtpClient = {
  /** Completes OTP auth, logging in or registering when needed. */
  completeOtp: TurnkeyClientMethods['completeOtp']
  /** Sends an OTP code to an email address. */
  initOtp: TurnkeyClientMethods['initOtp']
}

/** Options for requesting an email OTP auth ceremony. */
export type TurnkeyEmailOtpOptions = {
  /** Turnkey client that will perform OTP requests. */
  client: TurnkeyEmailOtpClient
  /** Optional sub-organization params used when Turnkey creates a new account. */
  createSubOrgParams?: CreateSubOrgParams | undefined
}

/** Active email OTP request rendered by the playground UI. */
export type TurnkeyEmailOtpRequest = TurnkeyEmailOtpOptions & {
  /** Rejects the pending adapter request. */
  reject: (error: Error) => void
  /** Resolves the pending adapter request after successful auth. */
  resolve: () => void
}

let request: TurnkeyEmailOtpRequest | undefined
const listeners = new Set<() => void>()

/** Returns the active email OTP request for React rendering. */
export function useTurnkeyEmailOtpRequest() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Request an email OTP ceremony from the React playground UI. */
export function requestTurnkeyEmailOtp(options: TurnkeyEmailOtpOptions) {
  if (request) request.reject(new Error('Another Turnkey email OTP request is already active.'))

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
export function resolveTurnkeyEmailOtp() {
  request?.resolve()
  request = undefined
  emit()
}

/** Reject and clear the active email OTP request. */
export function rejectTurnkeyEmailOtp(error: Error) {
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
