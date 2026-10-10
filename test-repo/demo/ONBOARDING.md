# Checkout service — one-page onboarding (show this last)

This small service calculates shopping-cart totals and loads inventory. It is a
local-first, self-hostable DevPulse demonstration; it never processes real payments.

| File | Purpose | Why a change matters |
| --- | --- | --- |
| `cart.mjs` | Shared price × quantity calculation and inventory lookup | A quantity bug changes every receipt and payment amount |
| `cart.test.mjs` | Empty cart, multiple quantities and mixed items | Deterministic safety check before the demo push |
| `autocomplete.mjs` | Small editable function | Show inline completion, then Explain Selection / Write Tests |
| `shipping.mjs` (candidate branch) | Proposed inventory integration | Review HTTP failures before accepting the proposal |

Start with `node cart.test.mjs`. Follow the data from cart items → `total()` →
payment amount. The incoming commit deliberately drops quantity multiplication;
the proposed shipping change deliberately ignores HTTP error responses.

For the closing AI explanation, open `cart.mjs`, include the current file in Chat,
and ask: “Give a two-sentence onboarding summary: purpose, inputs, outputs, and
what callers would be affected by changing total.” Only this file is sent. This
page is a curated codebase summary, not an automatic whole-repository AI scan.

No production credentials or external Git remote are included. AI explanations,
highlights and ghost completions require your configured model endpoint.
