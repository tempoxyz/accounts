const fs = require('node:fs')
const path = require('node:path')

const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)
const resolveRequest =
  config.resolver.resolveRequest ??
  ((context, moduleName, platform) => context.resolveRequest(context, moduleName, platform))
const src = path.resolve(__dirname, '../../src')

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    moduleName.startsWith('.') &&
    moduleName.endsWith('.js') &&
    context.originModulePath.startsWith(src)
  ) {
    const base = path.resolve(path.dirname(context.originModulePath), moduleName.slice(0, -3))

    for (const ext of ['.ts', '.tsx']) {
      const filePath = `${base}${ext}`
      if (fs.existsSync(filePath)) return { filePath, type: 'sourceFile' }
    }
  }

  return resolveRequest(context, moduleName, platform)
}

module.exports = config
