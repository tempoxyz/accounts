export type Kv = {
  get: <value = unknown>(key: string) => Promise<value>
  set: (key: string, value: unknown) => Promise<void>
  delete: (key: string) => Promise<void>
}
export declare function from<kv extends Kv>(kv: kv): kv
export declare function cloudflare(kv: cloudflare.Parameters): Kv
export declare namespace cloudflare {
  type Parameters = {
    get: <value = unknown>(key: string, format: 'json') => Promise<value>
    put: (key: string, value: string) => Promise<void>
    delete: (key: string) => Promise<void>
  }
}
export declare function memory(): Kv
//# sourceMappingURL=Kv.d.ts.map
