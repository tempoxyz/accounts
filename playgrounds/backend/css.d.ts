/** The stylesheet that Wrangler imports as text, by the `rules` of `wrangler.jsonc`. @module */
declare module '*.css' {
  /** The stylesheet's text. */
  const text: string
  export default text
}
