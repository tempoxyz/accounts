import type * as Store from './Store.js'
/** Dialog interface — manages the iframe/popup lifecycle for cross-origin auth. */
export type Dialog = SetupFn & Meta
/** Static metadata attached to a dialog function. */
export type Meta = {
  /** Identifier for the dialog type (e.g. `'iframe'`, `'popup'`). */
  name?: string | undefined
}
export type Instance = {
  /** Close the dialog (hide iframe / close popup). */
  close: () => void
  /** Destroy the dialog (remove DOM elements, clean up). */
  destroy: () => void
  /** Open the dialog (show iframe / open popup). */
  open: () => void
  /** Sync the pending request queue to the remote auth app. */
  syncRequests: (requests: readonly Store.QueuedRequest[]) => Promise<void>
}
/** The setup function a dialog must implement. */
export type SetupFn = (parameters: SetupFn.Parameters) => Instance
export declare namespace SetupFn {
  type Parameters = {
    /** URL of the Tempo Auth app. */
    host: string
    /** Reactive state store. */
    store: Store.Store
  }
}
export declare const defaultSize: {
  height: number
  width: number
}
/** Creates a dialog from metadata and a setup function. */
export declare function define(meta: Meta, fn: SetupFn): Dialog
/** Detects an insecure context (e.g. HTTP) where iframes lack WebAuthn support. */
export declare function isInsecureContext(): boolean
/** Detects Safari (which does not support WebAuthn in cross-origin iframes). */
export declare function isSafari(): boolean
/** Creates an iframe dialog that embeds the auth app in a `<dialog>` element. */
export declare function iframe(): Dialog
/** Opens the auth app in a new browser window. */
export declare function popup(options?: popup.Options): Dialog
export declare namespace popup {
  type Options = {
    /** Popup window dimensions. @default `{ width: 360, height: 440 }` */
    size?:
      | {
          width: number
          height: number
        }
      | undefined
  }
}
/** Returns a no-op dialog for SSR environments. */
export declare function noop(): Dialog
//# sourceMappingURL=Dialog.d.ts.map
