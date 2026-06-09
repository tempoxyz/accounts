---
"accounts": patch
---

Added mobile web auth adapters: `mobileWebAuth()` and the `tempoWalletMobileWebAuth()` Tempo Wallet template, exported from the root entry. Metro (React Native) apps can import both from the `accounts/mobileWebAuth` subpath (as `mobileWebAuth` and `tempoWallet`), since Metro does not tree-shake.

Added `accounts/react-native/expo-web-browser` for Expo auth sessions and `accounts/react-native/expo-secure-store` (renamed from `accounts/react-native/secure-storage`) for Keychain-backed storage.

Added `ProviderRequest.parse()` for parsing typed provider request envelopes.

Removed the `reactNative()` adapter from `accounts/react-native` in favor of `mobileWebAuth()`.
