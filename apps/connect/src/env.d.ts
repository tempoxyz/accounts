type EnvironmentVariables = {
  readonly MODE: 'development' | 'production' | 'test'
  readonly VITE_POSTHOG_KEY: string | undefined
  readonly VITE_SENTRY_DSN: string | undefined
}

interface ImportMetaEnv extends EnvironmentVariables {}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare const __BUILD_VERSION__: string
