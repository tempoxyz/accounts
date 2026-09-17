import { describe, test } from 'vp/test'

import { deviceCode } from './deviceCode.js'

describe('deviceCode', () => {
  test('accepts explicitly undefined optional metadata', () => {
    const description: string | undefined = undefined
    const icon: string | undefined = undefined
    const websiteUrl: string | undefined = undefined

    deviceCode({
      meta: { name: 'Example', description, icon, websiteUrl },
      name: 'Example',
      onPrompt() {},
      rdns: 'com.example',
      url: 'https://example.com/auth/device',
    })
  })
})
