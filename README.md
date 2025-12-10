# HollaEx MCP Server (balance)

MCP server exposing a single tool, `getUserBalance`, which returns the authenticated HollaEx wallet balances.

## Prereqs
- Node 18+ (tested with Node 22)
- Dependencies: `npm install`
- HollaEx API credentials from https://apidocs.hollaex.com/ (set as env vars)

## Run (stdio)
```bash
HOLLAEX_API_KEY=your_key \
HOLLAEX_API_SECRET=your_secret \
npm start
```

The server defaults to stdio. To run as HTTP (for GPT connectors), set `MCP_TRANSPORT=http` (and optionally `MCP_HTTP_PORT`/`PORT`) and call `/mcp`.

Tools (with titles, descriptions, and schemas exposed to MCP clients):
- `getUserBalance` — title: “Get User Balance”  
  - Input: none  
  - Output: structured balances object (keys are `<asset>_balance`, `<asset>_available`, plus optional `user_id`)
- `placeOrder` — title: “Place Order”  
  - Input: `symbol` (string, e.g. `btc-usdt`), `side` (`buy`/`sell`), `size` (number), `type` (`limit`/`market`, default `limit`), `price` (number, required for limit)  
  - Output: structured order object (id, symbol, side, size, type, price, status, filled, timestamps, fee fields, etc.)

Optional env vars:
- `HOLLAEX_API_URL` (default `https://api.hollaex.com`)
- `HOLLAEX_WS_URL` (default `wss://api.hollaex.com/stream`)
- `HOLLAEX_API_EXPIRES_AFTER` (seconds, default `60`)

## Deploy to Vercel (HTTP)
- Files already include `api/mcp.js` for a Vercel serverless function.
- Required env vars on Vercel: `HOLLAEX_API_KEY`, `HOLLAEX_API_SECRET`.
- MCP endpoint: `https://<your-vercel-app>.vercel.app/api/mcp`
- Health check: `https://<your-vercel-app>.vercel.app/api/mcp/health` (also `/health`)
