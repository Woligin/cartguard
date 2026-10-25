# CartGuard

**An AI shopping agent that can only spend inside the rules you set, paying through PayPal.**

Built for the PayPal AI Hackathon (Agentic Commerce). Zero runtime dependencies, one command to run, works offline in mock mode and against the PayPal sandbox when you add credentials.

## The problem

Letting an AI agent buy things for you is risky: it can misread a request, be tricked by text inside a product page, or simply overspend. Today the choice is "approve every click yourself" (no automation) or "trust the agent with your card" (no safety).

## The idea

CartGuard separates **proposing** from **deciding**:

1. **The AI proposes.** It turns "I need a USB-C hub for my laptop under $30" into a structured request and picks the best product among candidates returned by the catalog.
2. **Plain code decides.** A deterministic policy engine (`src/policy.js`, unit tested) checks the proposal against your rules: monthly budget, per-purchase cap, allowed categories, blocked merchants, and an "agent may order alone up to $X" threshold.
3. **Three outcomes**
   - `auto` : within the threshold, the agent creates the PayPal order itself.
   - `approval` : above the threshold, the agent must wait for your explicit approval in the UI.
   - `deny` : any rule fails; no PayPal order is ever created.
4. **PayPal is the final gate.** Orders use the PayPal Orders v2 API (`intent=CAPTURE`). The buyer approves in PayPal, CartGuard captures only for the exact order it created.
5. **Everything is auditable.** Each purchase keeps a timeline: request, parsing, chosen item, every policy check with numbers, approval, order id, capture id.

Because the AI only returns an item id that must exist in the catalog, and prices always come from the catalog, a prompt injection inside a product title or the request cannot change the price or bypass a rule. The test suite includes this case.

## Run it

Requires Node 18 or newer. No `npm install` is needed.

```bash
node src/server.js
# open http://localhost:3000
```

With no `.env`, CartGuard runs in **mock mode**: the full flow works (agent, policy, approval, mock PayPal checkout, budget tracking) without any network call.

### Use the real PayPal sandbox

1. Create a sandbox REST app at https://developer.paypal.com (Apps & Credentials, Sandbox).
2. Copy `.env.example` to `.env` and fill `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`. `.env` is git-ignored; secrets are read only from environment variables.
3. Restart. The header badge shows `PayPal: paypal-sandbox`. Pay with a sandbox *personal* buyer account from the developer dashboard.

### Use an AI model (optional)

Set `LLM_PROVIDER=gemini` and `GEMINI_API_KEY` (Google AI Studio), or `LLM_PROVIDER=openai-compatible` with `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`. If the model errors or returns something invalid, CartGuard falls back to a rule-based parser, so the app never breaks. The audit trail records which one was used (`source=llm` or `source=rules`).

## How PayPal and AI are used

**PayPal (sandbox, Orders v2 REST API)**
- `POST /v1/oauth2/token` (client credentials) to authenticate.
- `POST /v2/checkout/orders` with `intent=CAPTURE` to create an order for exactly the amount the policy engine approved.
- The buyer approves the order on PayPal's checkout page (`payer-action` link), then PayPal redirects back.
- `POST /v2/checkout/orders/{id}/capture` captures only the order id CartGuard created and stored; any other id is refused.
- Without credentials the same flow runs against a local mock, so the project can be tried offline.

**AI (Google Gemini, optional OpenAI-compatible provider)**
- Runtime: the model turns a plain-language request into structured fields and picks one product among catalog candidates. It is called twice per request and tries several Gemini models in a row if one is busy or retired. If every call fails, a rule-based parser takes over.
- The model never sets prices and never decides anything about money: it may only return a catalog item id, which is validated, and the deterministic policy engine in `src/policy.js` makes the auto / approval / deny decision.
- Development: this project was built with the help of an AI coding assistant (Claude by Anthropic). The author directed the design, ran the project, tested it against the PayPal sandbox and reviewed the results.

## Other tools
Node.js 18+ (built-in `http`, `fetch`, `node:test`), no runtime dependencies.

## Tests

```bash
npm test
```

23 tests: policy rules (limits, budget, month boundaries, rounding), the agent and prompt-injection case, the full HTTP flow in mock mode (auto order, approval, deny, reject, wrong-token capture refused, policy changes), and the PayPal client against a local fake of the Orders v2 API (auth header, amount, return URLs, capture).

## Architecture

```
public/index.html   single-page UI (rules, request box, purchases, audit trail)
src/server.js       HTTP API and PayPal return/cancel handlers
src/llm.js          AI layer: parse request, choose among candidates, with rule-based fallback
src/catalog.js      demo catalog (the only source of items and prices)
src/policy.js       deterministic spending policy (the part that is allowed to say yes)
src/paypal.js       PayPal Orders v2 client (create, capture) with mock mode
src/store.js        JSON file state
test/               node:test suites
```

## What this does not do (honest limits)

- The catalog is a demo list, not a live product search. Replacing `src/catalog.js` with a product-search API is the main integration point.
- Shipping address, taxes and refunds are out of scope. Orders use `NO_SHIPPING`.
- PayPal's buyer approval is the last human step; CartGuard does not store payment methods or use vaulted funds.
- State is a local JSON file, suitable for a single user demo.

## License

MIT, see `LICENSE`.
