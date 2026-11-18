/**
 * Tests of the classification of the user's denial, which the wagmi connector throws as
 * `UserRejectedRequestError`.
 * @module
 */
import { describe, expect, test } from 'vite-plus/test'
import { RequestError } from '../Accounts.js'
import * as Callback from './Callback.js'

describe('Callback.checkRedirectUri', () => {
  // Each callback is text, as `open` resolves with it, so no runtime's `URL` parses it.
  test.for([
    {
      callback: 'com.example.app:/callback?code=c',
      expected: true,
      redirectUri: 'com.example.app:/callback',
    },
    {
      callback: 'COM.Example.App:/callback?code=c',
      expected: true,
      redirectUri: 'com.example.app:/callback',
    },
    {
      callback: 'com.example.app:/callback-other?code=c',
      expected: false,
      redirectUri: 'com.example.app:/callback',
    },
    {
      callback: 'com.example.app:/Callback?code=c',
      expected: false,
      redirectUri: 'com.example.app:/callback',
    },
    {
      callback: 'com.other.app:/callback?code=c',
      expected: false,
      redirectUri: 'com.example.app:/callback',
    },
    {
      callback: 'com.example.app://callback?code=c',
      expected: false,
      redirectUri: 'com.example.app:/callback',
    },
    {
      callback: 'https://app.example/callback?code=c#f',
      expected: true,
      redirectUri: 'https://app.example/callback?x=1',
    },
    {
      callback: 'HTTPS://App.Example:443/callback?code=c',
      expected: true,
      redirectUri: 'https://app.example/callback',
    },
    {
      callback: 'https://app.example?code=c',
      expected: true,
      redirectUri: 'https://app.example/',
    },
    {
      callback: 'https://other.example/callback?code=c',
      expected: false,
      redirectUri: 'https://app.example/callback',
    },
    {
      callback: 'https://app.example:8443/callback?code=c',
      expected: false,
      redirectUri: 'https://app.example/callback',
    },
    {
      callback: 'https://app.example.evil/callback?code=c',
      expected: false,
      redirectUri: 'https://app.example/callback',
    },
    {
      callback: 'http://app.example:80/callback?code=c',
      expected: true,
      redirectUri: 'http://app.example/callback',
    },
    {
      callback: 'https://app.example/a%20b/callback?code=c',
      expected: true,
      redirectUri: 'https://app.example/a b/callback',
    },
    {
      callback: 'https://app.example/caf%C3%A9?code=c',
      expected: true,
      redirectUri: 'https://app.example/café',
    },
    {
      callback: 'https://app.example/%7Euser/cb?code=c',
      expected: false,
      redirectUri: 'https://app.example/~user/cb',
    },
    {
      callback: 'https://app.example/callback?code=c',
      expected: true,
      redirectUri: 'https://app.example/a/../callback',
    },
    {
      callback: 'https://app.example/callback?code=c',
      expected: true,
      redirectUri: 'https://app.example/./callback',
    },
    {
      callback: 'https://xn--caf-dma.example/cb?code=c',
      expected: true,
      redirectUri: 'https://café.example/cb',
    },
    {
      callback: 'https://app.example/callback?code=c',
      expected: true,
      redirectUri: 'https://app.example/a/%2e%2e/callback',
    },
    {
      callback: 'com.example.app:/a%20b?code=c',
      expected: true,
      redirectUri: 'com.example.app:/a b',
    },
    {
      callback: 'https://app.example/a%2Fb?code=c',
      expected: false,
      redirectUri: 'https://app.example/a/b',
    },
    {
      callback: 'https://app.example/other/../evil?code=c',
      expected: false,
      redirectUri: 'https://app.example/callback',
    },
    {
      callback: 'https://app.example/callback/../evil?code=c',
      expected: false,
      redirectUri: 'https://app.example/callback',
    },
    {
      callback: 'https://ü@app.example:80/callback?code=c',
      expected: false,
      redirectUri: 'https://app.example/callback',
    },
    {
      callback: 'https://%C3%BC@app.example:80/callback?code=c',
      expected: false,
      redirectUri: 'https://app.example/callback',
    },
    {
      callback: 'https://evil.example%2F@app.example/callback?code=c',
      expected: false,
      redirectUri: 'https://app.example/callback',
    },
    {
      callback: 'https://evil.example%2Fapp.example/callback?code=c',
      expected: false,
      redirectUri: 'https://evil.example/app.example/callback',
    },
    {
      callback: 'https:/evil.example/..//app.example/callback?code=c',
      expected: false,
      redirectUri: 'https://app.example/callback',
    },
    {
      callback: 'com.example.app:/x/..//host/callback?code=c',
      expected: false,
      redirectUri: 'com.example.app://host/callback',
    },
    {
      callback: 'https:app.example/callback?code=c',
      expected: true,
      redirectUri: 'https://app.example/callback',
    },
    {
      callback: 'https:\\\\app.example\\callback?code=c',
      expected: true,
      redirectUri: 'https://app.example/callback',
    },
    {
      callback: 'com.example.app://Host:/callback?code=c',
      expected: false,
      redirectUri: 'com.example.app://host/callback',
    },
    {
      callback: 'com.example.app:callback/.?code=c',
      expected: false,
      redirectUri: 'com.example.app:callback/',
    },
    {
      callback: 'com.example.app:callback/?code=c',
      expected: true,
      redirectUri: 'com.example.app:callback/',
    },
    {
      callback: 'https://[2001:db8::1]/callback?code=c',
      expected: true,
      redirectUri: 'https://[2001:0db8:0:0:0:0:0:1]/callback',
    },
    {
      callback: 'https://[2001:db8::2]/callback?code=c',
      expected: false,
      redirectUri: 'https://[2001:db8::1]/callback',
    },
    {
      callback: 'com.example.app:/%25FF?code=c',
      expected: false,
      redirectUri: 'com.example.app:/%FF',
    },
    {
      callback: 'com.example.app:/%ff?code=c',
      expected: false,
      redirectUri: 'com.example.app:/%FF',
    },
    {
      callback: 'com.example.app:/%25?code=c',
      expected: false,
      redirectUri: 'com.example.app:/%',
    },
    {
      callback: 'https://app.example/callback?code=c',
      expected: true,
      redirectUri: 'https://app.example:0443/callback',
    },
    {
      callback: 'https://app.example:8443/callback?code=c',
      expected: true,
      redirectUri: 'https://app.example:08443/callback',
    },
    {
      callback: 'https://app.example:8444/callback?code=c',
      expected: false,
      redirectUri: 'https://app.example:08443/callback',
    },
    {
      callback: 'com.example.app://host:/callback?code=c',
      expected: true,
      redirectUri: 'com.example.app://host/callback',
    },
    {
      callback: 'com.example.app:caf%C3%A9?code=c',
      expected: true,
      redirectUri: 'com.example.app:café',
    },
    {
      callback: 'com.example.app:a%2Fb?code=c',
      expected: false,
      redirectUri: 'com.example.app:a/b',
    },
    {
      callback: 'com.example.app:callback/..?code=c',
      expected: false,
      redirectUri: 'com.example.app:callback/',
    },
    {
      callback: 'com.example.app://caf%C3%A9.example/cb?code=c',
      expected: true,
      redirectUri: 'com.example.app://café.example/cb',
    },
    {
      callback: 'com.example.app://xn--caf-dma.example/cb?code=c',
      expected: false,
      redirectUri: 'com.example.app://café.example/cb',
    },
    {
      callback: 'HTTPS://User@App.Example/callback?code=c',
      expected: true,
      redirectUri: 'https://User@app.example/callback',
    },
    {
      callback: 'https://192.0.2.1/callback?code=c',
      expected: true,
      redirectUri: 'https://0xc0000201/callback',
    },
    {
      callback: 'https://192.0.2.2/callback?code=c',
      expected: false,
      redirectUri: 'https://0xc0000201/callback',
    },
    {
      callback: 'com.example.app:/call\tback?code=c',
      expected: false,
      redirectUri: 'com.example.app:/call%09back',
    },
    {
      callback: 'com.example.app:/call\nback?code=c',
      expected: true,
      redirectUri: 'com.example.app:/callback',
    },
    {
      callback: ' com.example.app:/callback?code=c ',
      expected: true,
      redirectUri: 'com.example.app:/callback',
    },
    {
      callback: 'com.example.app:/caf%C%33%A9?code=c',
      expected: false,
      redirectUri: 'com.example.app:/caf%C3%A9',
    },
    {
      callback: 'com.example.app:/%F%46?code=c',
      expected: false,
      redirectUri: 'com.example.app:/%FF',
    },
    {
      callback: 'com.example.app:/\t/evil/../../cb?code=c',
      expected: false,
      redirectUri: 'com.example.app:/cb',
    },
    {
      callback: 'com.example.app:/callback?code=c&x=%',
      expected: true,
      redirectUri: 'com.example.app:/callback',
    },
    {
      callback: 'com.example.app:/a[b?code=c',
      expected: false,
      redirectUri: 'com.example.app:/a%5Bb',
    },
    {
      callback: 'com.example.app:/a\\b?code=c',
      expected: false,
      redirectUri: 'com.example.app:/a%5Cb',
    },
    {
      callback: 'com.example.app:/%41?code=c',
      expected: false,
      redirectUri: 'com.example.app:/A',
    },
    {
      callback: 'com.example.app:/a%5Bb?code=c',
      expected: true,
      redirectUri: 'com.example.app:/a%5Bb',
    },
    {
      callback: 'https://app.example/a%5Eb?code=c',
      expected: true,
      redirectUri: 'https://app.example/a^b',
    },
  ])('returns $expected for $callback at $redirectUri', (row) => {
    const accepted = (() => {
      try {
        Callback.checkRedirectUri(row.callback, {
          redirectUri: row.redirectUri,
        })
        return true
      } catch (error) {
        if (error instanceof RequestError && error.field === 'url') return false
        throw error
      }
    })()

    expect(accepted).toBe(row.expected)
  })
})

describe('Callback.denied', () => {
  const redirectUri = 'https://app.example.com/'

  test.for([
    {
      error: Callback.error(
        new URL('https://app.example.com/?error=access_denied&state=s'),
        { redirectUri },
      ),
      expected: true,
      name: "a callback's denial",
    },
    {
      error: new RequestError({
        code: 'access_denied',
        message: 'The user denied the request.',
        status: 400,
      }),
      expected: true,
      name: "a device grant's denial",
    },
    {
      error: new RequestError({
        code: 'access_denied',
        message: "The request names a Tempo Account that is not the user's.",
        reason: 'foreign_account',
        status: 403,
      }),
      expected: false,
      name: 'a refusal of Tempo ID with a reason',
    },
    {
      error: Callback.error(
        new URL('https://app.example.com/?error=login_required&state=s'),
        { redirectUri },
      ),
      expected: false,
      name: "a callback's other error",
    },
    {
      error: new DOMException('The user closed the sign-in.', 'AbortError'),
      expected: false,
      name: 'an AbortError',
    },
  ])('returns $expected for $name', (row) => {
    expect(Callback.denied(row.error)).toBe(row.expected)
  })
})
