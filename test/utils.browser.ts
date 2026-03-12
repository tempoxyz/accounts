import { type FrameLocator, page } from 'vitest/browser'

/**
 * Interact with the dialog iframe while a provider request is in flight.
 * Waits for the iframe to render, then executes the action.
 */
export async function interact<returnType>(
  promise: Promise<returnType>,
  action: (iframe: FrameLocator) => Promise<void>,
): Promise<returnType> {
  // Prevent unhandled rejection while we wait to interact with the iframe.
  promise.catch(() => {})
  await new Promise((resolve) => setTimeout(resolve, 500))
  await action(page.frameLocator(page.getByTestId('tempo-auth')))
  return promise
}
