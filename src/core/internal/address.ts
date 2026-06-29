import { Address } from 'ox'
import { isAddressEqual, zeroAddress } from 'viem'

export function from(value: unknown): Address.Address | undefined {
  if (typeof value === 'string' && Address.validate(value)) return value
  return undefined
}

export function isEqual(a: Address.Address, b: Address.Address): boolean {
  return isAddressEqual(a, b)
}

export function isZero(address: Address.Address): boolean {
  return isAddressEqual(address, zeroAddress)
}
