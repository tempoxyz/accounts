import { describe, expect, test } from 'vp/test'

import { normalizePendingApprovalResponse } from './deviceCode.js'

describe('normalizePendingApprovalResponse', () => {
  test('default: converts the exact transient persistence error into a pending response', async () => {
    const response = Response.json(
      {
        error: 'server_error',
        error_description: 'approved but no response queued',
      },
      {
        headers: { 'content-length': '999', 'x-request-id': 'approval-race' },
        status: 500,
      },
    )

    const normalized = await normalizePendingApprovalResponse(response)

    expect({
      body: await normalized.json(),
      contentLength: normalized.headers.get('content-length'),
      requestId: normalized.headers.get('x-request-id'),
      status: normalized.status,
    }).toMatchInlineSnapshot(`
      {
        "body": {
          "error": "authorization_pending",
        },
        "contentLength": null,
        "requestId": "approval-race",
        "status": 400,
      }
    `)
  })

  test.each([
    {
      name: 'a different status',
      response: () =>
        Response.json(
          {
            error: 'server_error',
            error_description: 'approved but no response queued',
          },
          { status: 503 },
        ),
    },
    {
      name: 'a different error code',
      response: () =>
        Response.json(
          {
            error: 'temporarily_unavailable',
            error_description: 'approved but no response queued',
          },
          { status: 500 },
        ),
    },
    {
      name: 'a different error description',
      response: () =>
        Response.json(
          {
            error: 'server_error',
            error_description: 'provider unavailable',
          },
          { status: 500 },
        ),
    },
    {
      name: 'a non-JSON response',
      response: () => new Response('provider unavailable', { status: 500 }),
    },
  ])('behavior: preserves $name', async ({ response }) => {
    const original = response()

    const normalized = await normalizePendingApprovalResponse(original)

    expect(normalized).toBe(original)
  })
})
