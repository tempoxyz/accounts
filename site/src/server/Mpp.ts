/** Serves the routes of the demos of "MPP", under `/api/mpp`. @module */

/** Path that each route of the topic starts with. */
export const path = '/api/mpp'

/** Answers a request to a route of the topic. The topic holds no route yet. */
export function fetch(): Promise<Response> | Response {
  return Response.json({ error: 'not_found' }, { status: 404 })
}
