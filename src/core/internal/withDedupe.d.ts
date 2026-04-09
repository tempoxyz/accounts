/** Deduplicates in-flight promises by key. */
export declare function withDedupe<data>(
  fn: () => Promise<data>,
  { enabled, id }: withDedupe.Options,
): Promise<data>
export declare namespace withDedupe {
  var cache: Map<string, Promise<any>>
}
export declare namespace withDedupe {
  type Options = {
    enabled?: boolean | undefined
    id?: string | undefined
  }
}
//# sourceMappingURL=withDedupe.d.ts.map
