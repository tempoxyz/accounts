import { createRouter, parseSearchWith, stringifySearchWith } from '@tanstack/react-router'
import { Json } from 'ox'

import { routeTree } from './routeTree.gen'

export const router = createRouter({
  routeTree,
  scrollRestoration: true,
  parseSearch: parseSearchWith(Json.parse),
  stringifySearch: stringifySearchWith(Json.stringify),
})

export function getRouter() {
  return router
}
