/**
 * The parts that the demos of "API authentication" share: the API route of the site, the reader
 * of its response, and the element that shows the response.
 * @module
 */
import './Call.css'

/** Path that each route of the topic starts with, as `src/server/ApiAuthentication.ts` serves it. */
export const path = '/api/api-authentication'

/**
 * The API route, which returns the user of a request, or refuses the request with 401. It accepts
 * the session cookie of the backend, or an access token.
 */
export const route = `${path}/me`

/**
 * The API route that accepts only an access token. A request to it carries each cookie of the
 * page's origin, and the route reads none of them.
 */
export const tokenRoute = `${path}/token/me`

/** A response of the API route. Its body names a user ID or an error, and never holds a token. */
export type Result = {
  /** Body of the response, as text. The API route answers with JSON. */
  body: string
  /** HTTP status of the response. */
  status: number
}

/**
 * Reads the status and the body of a response of the API route. It keeps the body as text, so it
 * also shows the answer of a proxy before the site, which is not JSON.
 */
export async function read(response: Response): Promise<Result> {
  return { body: await response.text(), status: response.status }
}

/** Shows a response of the API route: its status, then its body. */
export function Call(props: Call.Props) {
  const { result } = props

  return (
    <span data-call="" data-ok={result.status < 400}>
      <span data-call-status="">{result.status}</span>
      <code data-call-body="">{result.body}</code>
    </span>
  )
}

export declare namespace Call {
  /** Properties for the Call component. */
  type Props = {
    /** Response to show. */
    result: Result
  }
}
