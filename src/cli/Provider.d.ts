import * as CoreProvider from '../core/Provider.js'
import { cli } from './adapter.js'
/**
 * Creates a provider that bootstraps access-key authorization through the CLI
 * device-code flow.
 */
export declare function create(options: create.Options): create.ReturnType
export declare namespace create {
  type Options = Omit<
    CoreProvider.create.Options & cli.Options,
    'adapter' | 'authorizeAccessKey' | 'host'
  > & {
    /** Host URL for the device-code flow. @default "https://wallet.tempo.xyz/embed/cli-auth" */
    host?: string | undefined
  }
  type ReturnType = CoreProvider.create.ReturnType
}
//# sourceMappingURL=Provider.d.ts.map
