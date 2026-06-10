---
"accounts": patch
---

Add encrypted MMKV-backed React Native storage that manages its SecureStore encryption key internally.

Remove `secureStorage` from `accounts/react-native/expo-secure-store`; use `secureMmkv` from `accounts/react-native/secure-mmkv` instead.
