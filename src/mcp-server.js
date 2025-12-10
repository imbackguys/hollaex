// Simple MCP server exposing one tool: getUserBalance
// Uses hollaex-node-lib and MCP stdio transport.

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { createMcpExpressApp } = require('@modelcontextprotocol/sdk/server/express.js');
const z = require('zod');
const hollaex = require('hollaex-node-lib');

const API_KEY = process.env.HOLLAEX_API_KEY;
const API_SECRET = process.env.HOLLAEX_API_SECRET;
const API_URL = process.env.HOLLAEX_API_URL || 'https://api.hollaex.com';
const WS_URL = process.env.HOLLAEX_WS_URL || 'wss://api.hollaex.com/stream';
const API_EXPIRES_AFTER = Number(process.env.HOLLAEX_API_EXPIRES_AFTER || 60);

function makeClient() {
  if (!API_KEY || !API_SECRET) {
    throw new Error(
      'Missing HOLLAEX_API_KEY or HOLLAEX_API_SECRET environment variables.'
    );
  }

  return new hollaex({
    apiURL: API_URL,
    wsURL: WS_URL,
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    apiExpiresAfter: API_EXPIRES_AFTER,
  });
}

function buildServer() {
  const server = new McpServer({
    name: 'hollaex-trading-mcp',
    version: '1.0.0',
  });

  const balanceOutputSchema = z
    .object({ user_id: z.number().optional() })
    .catchall(z.number());

  server.registerTool(
    'getUserBalance',
    {
      title: 'Get User Balance',
      description: 'Return the authenticated user balances from HollaEx.',
      inputSchema: z.object({}),
      outputSchema: balanceOutputSchema,
    },
    async () => {
      const client = makeClient();
      const balances = await client.getBalance();
      return {
        content: [
          {
            type: 'text',
            text: 'Fetched user balances.',
          },
        ],
        structuredContent: balances,
      };
    }
  );

  const orderOutputSchema = z
    .object({
      id: z.string(),
      symbol: z.string(),
      side: z.string(),
      size: z.number(),
      type: z.string(),
      price: z.number().optional(),
      status: z.string(),
      filled: z.number(),
      average: z.number().nullable().optional(),
      fee: z.number().optional(),
      fee_coin: z.string().optional(),
      created_at: z.string(),
      updated_at: z.string(),
      fee_structure: z
        .object({ maker: z.number(), taker: z.number() })
        .optional(),
      stop: z.number().nullable().optional(),
      meta: z.record(z.string(), z.unknown()).optional(),
    })
    .passthrough();

  server.registerTool(
    'placeOrder',
    {
      title: 'Place Order',
      description: 'Place a user order on HollaEx (limit or market).',
      inputSchema: z.object({
        symbol: z
          .string()
          .describe('Trading pair symbol, e.g. btc-usdt or eth-usdt'),
        side: z.enum(['buy', 'sell']).describe('Order side'),
        size: z
          .number()
          .positive()
          .describe('Order size (base currency amount)'),
        type: z
          .enum(['limit', 'market'])
          .default('limit')
          .describe('Order type'),
        price: z
          .number()
          .positive()
          .optional()
          .describe('Required for limit orders; ignored for market orders'),
      }),
      outputSchema: orderOutputSchema,
    },
    async ({ symbol, side, size, type, price }) => {
      try {
        console.error(
          `placeOrder called: ${symbol} ${side} ${size} ${type} ${price ?? ''}`
        );
        if (type === 'limit' && !price) {
          throw new Error('price is required for limit orders');
        }
        const client = makeClient();
        const order = await client.createOrder(
          symbol,
          side,
          size,
          type,
          type === 'limit' ? price : undefined
        );
        console.error(`placeOrder success id=${order.id}`);
        return {
          content: [
            {
              type: 'text',
              text: `Placed order ${order.id}`,
            },
          ],
          structuredContent: order,
        };
      } catch (err) {
        console.error('placeOrder error', err);
        throw err;
      }
    }
  );

  return server;
}

async function startStdio() {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('HollaEx MCP server running on stdio.');
}

function createHttpApp() {
  const app = createMcpExpressApp({ host: '0.0.0.0' });

  const mcpPaths = ['/mcp', '/api/mcp'];

  const handler = async (req, res) => {
    try {
      const server = buildServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on('close', () => {
        transport.close();
        server.close();
      });
    } catch (error) {
      console.error('Error handling MCP request:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  };

  mcpPaths.forEach((path) => {
    app.post(path, handler);
    app.options(path, (_req, res) => res.status(200).json({ ok: true }));
    app.get(path, (_req, res) =>
      res.status(200).json({ ok: true, message: 'POST MCP requests here' })
    );
  });

  const healthPaths = ['/health', '/api/mcp/health'];
  healthPaths.forEach((path) => {
    app.get(path, (_req, res) => res.status(200).json({ ok: true }));
  });

  return app;
}

async function startHttp() {
  const app = createHttpApp();
  const port = Number(process.env.MCP_HTTP_PORT || process.env.PORT || 3000);
  app.listen(port, (err) => {
    if (err) {
      console.error('Failed to start HTTP MCP server:', err);
      process.exit(1);
    }
    console.error(`HollaEx MCP HTTP server listening on :${port}/mcp`);
  });
}

async function main() {
  const mode =
    process.env.MCP_TRANSPORT ||
    (process.argv.includes('--http') ? 'http' : 'stdio');
  if (mode === 'http') {
    await startHttp();
  } else {
    await startStdio();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Failed to start MCP server:', err);
    process.exit(1);
  });
}

module.exports = { createHttpApp, buildServer };
