/**
 * Stands in for `@modelcontextprotocol/sdk/types.js`, an optional peer of mppx that its server imports
 * only for MCP transports. The API serves HTTP alone, so the Worker's bundle aliases the import here,
 * and the import rejects if anything reaches it.
 * @module
 */
throw new Error('The API serves no MCP transport.')
