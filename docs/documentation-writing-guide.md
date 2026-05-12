---
description: Positioning, voice, structure, and terminology for Accounts SDK docs.
---

# Documentation writing guide

Use this guide when writing or reviewing Accounts SDK documentation. The docs should help developers choose an account model, integrate it correctly, and understand how the SDK connects Tempo account features to their app.

## Positioning

The Accounts SDK is common account tooling for apps and wallets building on Tempo. It gives developers one provider surface, reusable adapters, shared examples, and common integration patterns while adapters decide where keys live, who runs authentication, and how account requests are approved.

Lead with the decision the reader needs to make:

| Path | Position it as | Use it when |
| --- | --- | --- |
| Tempo Wallet | Hosted universal wallet for Tempo account creation, signing, onramp, access keys, and transaction orchestration. | Most apps want embedded account flows without owning auth or signing infrastructure. |
| WebAuthn | Domain-bound passkey accounts controlled by the app origin. | The app needs to own the passkey ceremony, user account model, or recovery flow. |
| Custom adapter | Integration layer for auth, custody, or signing systems the team already operates. | Privy, AWS KMS, Turnkey, internal signers, or enterprise wallet infrastructure already own the signing path. |
| MPP | Machine-to-machine payments over HTTP `402`, with Accounts SDK signing where needed. | The reader is building paid APIs, agents, sessions, subscriptions, or MCP tool payments. |

Most docs should start from Tempo Wallet unless the page is explicitly about WebAuthn, custom adapters, or MPP. Make alternatives visible, but do not force every page to re-explain every adapter.

## Core message

Use this as the default mental model:

> Your app talks to the Accounts SDK. The SDK routes account requests through an adapter. The adapter handles signing through Tempo Wallet, WebAuthn, or your own infrastructure.

For product copy, connect the model to practical outcomes:

- Users can create accounts, approve payments, and authorize scoped access without every app rebuilding wallet infrastructure.
- Common primitives let examples, integrations, LLM instructions, and ecosystem tooling improve together instead of fragmenting by signing model.
- Tempo-specific features like stablecoin payments, fee sponsorship, access keys, batching, subscriptions, and MPP compose through the same account surface.

## Audience

Write for developers who are integrating a payment or account flow, not readers studying the protocol for its own sake. Assume they know TypeScript and common wallet libraries. Do not assume they know Tempo-specific transaction features, passkey constraints, or MPP terminology.

Default to app-builder language:

| Prefer | Avoid |
| --- | --- |
| app, account, signing, payment, stablecoin | dapp, crypto user, chain abstraction |
| create an account | onboard a user |
| approve a payment | sign a payload |
| sponsor fees | gasless UX |
| domain-bound passkey | embedded WebAuthn wallet, unless the distinction matters |
| one provider surface | abstraction layer |

Use protocol language only when it helps the reader implement correctly. When you introduce a protocol term, explain its job in the flow.

## Voice

The voice is neutral, confident, and specific. State what the product does, when to use it, and what tradeoff the reader accepts.

Write like this:

- "Most apps should start with Tempo Wallet."
- "Use WebAuthn when your app owns the passkey ceremony."
- "Access keys let a user authorize a secondary key for scoped signing."
- "Sessions are for repeated low-value payments where one onchain transaction per request would be too expensive."

Avoid this:

- "unlock seamless experiences"
- "leverage powerful infrastructure"
- "revolutionary wallet abstraction"
- "frictionless crypto onboarding"
- "secure and robust by default"

Avoid hype, rhetorical questions, and vague benefit claims. If a sentence says "simple", "easy", "seamless", "powerful", or "robust", replace it with the concrete reason.

## Page shapes

### Concept pages

Use concept pages for choices and mental models.

1. State what the thing is.
2. Explain when to use it.
3. Show the integration shape.
4. Name the tradeoffs and production responsibilities.
5. Link to the first implementation step.

Good sections:

- What it is
- When to use it
- How it works
- Production notes
- Next steps

### Guides

Use guides for an implementation outcome.

1. Start with the outcome.
2. List prerequisites only when they block the first step.
3. Give a minimal working path.
4. Add verification or expected result.
5. Add production notes after the working path.
6. End with specific next steps.

The reader should be able to copy the code path, run it, and know whether it worked.

### Reference pages

Use reference pages for exported APIs, RPC methods, and configuration.

1. One-sentence purpose.
2. Import or request shape.
3. Parameters.
4. Return value.
5. Minimal example.
6. Errors, defaults, or security notes.
7. Related guide.

Do not make reference pages carry product positioning. Link to concept pages for decisions.

### Enterprise pages

Enterprise docs need sharper boundaries than general guides. Say what the team owns, what Tempo Wallet owns, and what the SDK mediates.

Include:

- Identity and session ownership.
- Key custody or signing responsibility.
- Approval UX ownership.
- Recovery and compliance constraints.
- Adapter boundary and request translation.
- Security review notes before production.

## Technical style

Put the safest path first. Prefer the integration path this repo supports today, then mention alternatives.

- Use Wagmi first for app guides.
- Use `Provider.create()` and Viem for vanilla examples.
- Use server handlers for server-owned policy, WebAuthn ceremonies, relays, and fee sponsorship.
- Keep code examples minimal and runnable.
- Use `tsx twoslash` when the example should typecheck in docs.
- Highlight the line that changed only when a larger example needs focus.
- Keep placeholders explicit: `<YOUR_ADDRESS>`, `<RPC_URL>`, `<AUTH_URL>`.
- Mention secure-origin requirements before WebAuthn or iframe behavior can fail.
- Put production caveats close to the code that triggers them.

Do not show a toy version that teaches the wrong production model. If a local-only implementation is useful, name it as local-only and point to the production option.

## Terminology

Use these terms consistently:

| Term | Use |
| --- | --- |
| Accounts SDK | Product name. Do not shorten to Account SDK. |
| Tempo Wallet | Hosted wallet surface. Use this spelling. |
| adapter | Signing backend behind the SDK provider. Lowercase unless in a title. |
| Tempo Wallet adapter | Adapter that delegates approval and signing to Tempo Wallet. |
| WebAuthn adapter | Adapter for domain-bound passkey accounts. |
| domain-bound passkey | Passkey credential bound to the app origin. |
| custom adapter | Adapter for app-owned auth, custody, or signing systems. |
| access key | Secondary key authorized for scoped signing. |
| fee sponsorship | Third party paying fees on behalf of the user. |
| fee payer | Account or service that sponsors the fee. |
| Tempo Transactions | Tempo transaction type with fee tokens, batching, access keys, scheduling, and sponsorship. |
| TIP-20 | Tempo stablecoin token standard. |
| MPP | Machine Payments Protocol after first mention. |
| Challenge, Credential, Receipt | Capitalize when referring to MPP protocol objects. |
| HTTP `402` | Status code for payment-required flows. |

Avoid generic "wallet" when the type matters. Say "Tempo Wallet", "browser wallet", "domain-bound passkey account", or "custom adapter".

## MPP framing

MPP docs should start from the problem: agents, apps, and services need to exchange payment terms and payment proof in the same request flow.

Use this model:

> A service returns an HTTP `402` Challenge. The client pays using a supported method and retries with a Credential. The service verifies the payment and returns the resource with a Receipt.

When the Accounts SDK appears in MPP docs, explain the boundary clearly:

- MPP defines the payment negotiation and proof flow.
- Tempo provides stablecoin settlement and session payments.
- The Accounts SDK provides account signing and adapter-based wallet access where the client or app needs it.

Do not imply MPP requires Tempo for every payment method. MPP is payment-method agnostic; Tempo is the preferred settlement layer when speed, predictable cost, and stablecoin-native flows matter.

## Structure and formatting

- Use sentence-case headings.
- Keep headings short and concrete.
- Use tables for choices, parameters, and compatibility.
- Use bullets for discrete facts, not for every paragraph.
- Use Mermaid for flows.
- Do not use ASCII or Unicode box diagrams.
- Use descriptive link text.
- Use admonitions sparingly for warnings, production caveats, and local-only notes.
- Keep page descriptions specific enough to appear in search results.
- End major pages with next steps, not a generic CTA.

## Before and after

| Instead of | Write |
| --- | --- |
| The Accounts SDK unlocks seamless wallet experiences for developers. | The Accounts SDK gives developers common account primitives for Tempo Wallet, WebAuthn, custom signing infrastructure, and the tooling built on top of them. |
| Leverage WebAuthn to enhance security. | Use WebAuthn when your app owns passkey registration, authentication, and recovery. |
| Gasless transactions improve UX. | Fee sponsorship lets a fee payer cover transaction fees for the user. |
| MPP facilitates autonomous agent commerce. | MPP lets agents pay for API requests with HTTP `402` payment challenges and credentials. |
| This guide will walk you through how to easily integrate payments. | This guide connects an account, sends a stablecoin payment, and verifies the receipt. |

## Review checklist

- The page states who it is for and what the reader can do after reading it.
- The first recommendation matches the likely reader path.
- Tempo Wallet, WebAuthn, custom adapters, and MPP are positioned with clear boundaries.
- Claims are concrete and tied to product behavior.
- Terms match the terminology table.
- Code examples are current, minimal, and runnable.
- Production caveats are near the relevant code.
- The page links to the next implementation step.
- The page avoids hype, vague adjectives, and crypto-native shorthand.
- Mermaid is used for diagrams.
