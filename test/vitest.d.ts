// Vitest only hoists `vi.mock` calls when `vi` is imported from 'vitest', but
// 'vitest' is not a direct dependency (it ships inside `vp`), so type the bare
// specifier here. Import everything else from 'vp/test'.
declare module 'vitest' {
  export const vi: typeof import('vp/test').vi
}
