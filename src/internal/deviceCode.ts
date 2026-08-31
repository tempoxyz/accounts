/**
 * Converts Wata's transient approved-without-response state into the device-code
 * polling signal understood by RFC 8628 consumers.
 *
 * @internal
 */
export async function normalizePendingApprovalResponse(response: Response): Promise<Response> {
  if (response.status !== 500) return response

  const body = (await response
    .clone()
    .json()
    .catch(() => undefined)) as { error?: unknown; error_description?: unknown } | undefined
  if (
    body?.error !== 'server_error' ||
    body.error_description !== 'approved but no response queued'
  )
    return response

  const headers = new Headers(response.headers)
  headers.delete('content-length')
  return Response.json({ error: 'authorization_pending' }, { headers, status: 400 })
}
