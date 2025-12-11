// MCP server exposing HollaEx trading tools.
// Uses hollaex-node-lib and MCP stdio/HTTP transport.

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

const genericOutputSchema = z.unknown();

const formatResponse = (message, structuredContent) => ({
  content: [{ type: 'text', text: message }],
  structuredContent,
});

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
      return formatResponse('Fetched user balances.', balances);
    }
  );

  server.registerTool(
    'getBalance',
    {
      title: 'Get User Balance',
      description: 'Return the authenticated user balances from HollaEx.',
      inputSchema: z.object({}),
      outputSchema: balanceOutputSchema,
    },
    async () => {
      const client = makeClient();
      const balances = await client.getBalance();
      return formatResponse('Fetched user balances.', balances);
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

  const cancelOutputSchema = z
    .object({
      id: z.string().optional(),
      order_id: z.string().optional(),
      message: z.string().optional(),
      status: z.string().optional(),
    })
    .passthrough();

  server.registerTool(
    'placeOrder',
    {
      title: 'Place Order',
      description:
        'Place a user order on HollaEx. Set type to market (no price) or limit (requires price).',
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
          .describe('Order type (must choose market or limit)'),
        price: z
          .number()
          .positive()
          .optional()
          .describe('Required for limit orders; ignored for market orders'),
        stop: z.number().positive().optional().describe('Optional stop price'),
        meta: z
          .object({
            post_only: z.boolean().optional(),
            note: z.string().optional(),
          })
          .passthrough()
          .optional()
          .describe('Optional meta configuration'),
      }),
      outputSchema: orderOutputSchema,
    },
    async ({ symbol, side, size, type, price, stop, meta }) => {
      try {
        console.error(
          `placeOrder called: ${symbol} ${side} ${size} ${type} ${price ?? ''}`
        );
        if (type === 'limit' && !price) {
          throw new Error('price is required for limit orders');
        }
        const client = makeClient();
        const priceToSend = type === 'limit' ? price : 0;
        const opts = {};
        if (stop !== undefined) {
          opts.stop = stop;
        }
        if (meta) {
          opts.meta = meta;
        }
        const order = await client.createOrder(
          symbol,
          side,
          size,
          type,
          priceToSend,
          Object.keys(opts).length ? opts : undefined
        );
        console.error(`placeOrder success id=${order.id}`);
        return formatResponse(`Placed order ${order.id}`, order);
      } catch (err) {
        console.error('placeOrder error', err);
        throw err;
      }
    }
  );

  server.registerTool(
    'cancelOrder',
    {
      title: 'Cancel Order',
      description: 'Cancel an existing order by order ID.',
      inputSchema: z.object({
        orderId: z.string().describe('Order ID to cancel'),
      }),
      outputSchema: cancelOutputSchema,
    },
    async ({ orderId }) => {
      try {
        console.error(`cancelOrder called: ${orderId}`);
        const client = makeClient();
        const result = await client.cancelOrder(orderId);
        return formatResponse(`Canceled order ${orderId}`, result);
      } catch (err) {
        console.error('cancelOrder error', err);
        throw err;
      }
    }
  );

  server.registerTool(
    'getKit',
    {
      title: 'Get Kit',
      description: 'Get exchange information (name, languages, description).',
      inputSchema: z.object({}),
      outputSchema: genericOutputSchema,
    },
    async () => {
      const client = makeClient();
      const kit = await client.getKit();
      return formatResponse('Fetched kit information.', kit);
    }
  );

  server.registerTool(
    'getConstants',
    {
      title: 'Get Constants',
      description:
        'Retrieve tick size, min/max price, min/max size of each symbol pair and coin.',
      inputSchema: z.object({}),
      outputSchema: genericOutputSchema,
    },
    async () => {
      const client = makeClient();
      const constants = await client.getConstants();
      return formatResponse('Fetched constants.', constants);
    }
  );

  server.registerTool(
    'getTicker',
    {
      title: 'Get Ticker',
      description: 'Retrieve 24h ticker data for a specific symbol.',
      inputSchema: z.object({
        symbol: z
          .string()
          .describe('Trading pair symbol, e.g. xht-usdt or btc-usdt'),
      }),
      outputSchema: genericOutputSchema,
    },
    async ({ symbol }) => {
      const client = makeClient();
      const ticker = await client.getTicker(symbol);
      return formatResponse(`Fetched ticker for ${symbol}.`, ticker);
    }
  );

  server.registerTool(
    'getTickers',
    {
      title: 'Get Tickers',
      description: 'Retrieve 24h ticker data for all symbols.',
      inputSchema: z.object({}),
      outputSchema: genericOutputSchema,
    },
    async () => {
      const client = makeClient();
      const tickers = await client.getTickers();
      return formatResponse('Fetched tickers for all symbols.', tickers);
    }
  );

  server.registerTool(
    'getOrderbook',
    {
      title: 'Get Orderbook',
      description: 'Retrieve orderbook for a symbol.',
      inputSchema: z.object({
        symbol: z
          .string()
          .describe('Trading pair symbol, e.g. xht-usdt or btc-usdt'),
      }),
      outputSchema: genericOutputSchema,
    },
    async ({ symbol }) => {
      const client = makeClient();
      const orderbook = await client.getOrderbook(symbol);
      return formatResponse(`Fetched orderbook for ${symbol}.`, orderbook);
    }
  );

  server.registerTool(
    'getOrderbooks',
    {
      title: 'Get Orderbooks',
      description: 'Retrieve orderbooks for all symbols.',
      inputSchema: z.object({}),
      outputSchema: genericOutputSchema,
    },
    async () => {
      const client = makeClient();
      const orderbooks = await client.getOrderbooks();
      return formatResponse('Fetched orderbooks.', orderbooks);
    }
  );

  server.registerTool(
    'getTrades',
    {
      title: 'Get Trades',
      description: 'Retrieve recent trades; optionally filter by symbol.',
      inputSchema: z.object({
        symbol: z
          .string()
          .optional()
          .describe('Optional trading pair symbol, e.g. xht-usdt'),
      }),
      outputSchema: genericOutputSchema,
    },
    async ({ symbol }) => {
      const client = makeClient();
      const trades = await client.getTrades({ symbol });
      return formatResponse(
        `Fetched recent trades${symbol ? ` for ${symbol}` : ''}.`,
        trades
      );
    }
  );

  server.registerTool(
    'getUser',
    {
      title: 'Get User',
      description: "Retrieve the authenticated user's profile information.",
      inputSchema: z.object({}),
      outputSchema: genericOutputSchema,
    },
    async () => {
      const client = makeClient();
      const user = await client.getUser();
      return formatResponse('Fetched user profile.', user);
    }
  );

  server.registerTool(
    'getUserTrades',
    {
      title: 'Get User Trades',
      description: "Retrieve the user's trade history.",
      inputSchema: z.object({
        symbol: z
          .string()
          .optional()
          .describe('Optional trading pair symbol, e.g. xht-usdt'),
        limit: z
          .number()
          .int()
          .positive()
          .max(50)
          .optional()
          .describe('Trades per page (max 50)'),
        page: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Page number (default 1)'),
        orderBy: z.string().optional().describe('Field to order by'),
        order: z.enum(['asc', 'desc']).optional().describe('Sort direction'),
        startDate: z
          .string()
          .optional()
          .describe('ISO8601 start date filter'),
        endDate: z
          .string()
          .optional()
          .describe('ISO8601 end date filter'),
        format: z
          .enum(['all', 'csv'])
          .optional()
          .describe('Response format'),
      }),
      outputSchema: genericOutputSchema,
    },
    async (filters) => {
      const client = makeClient();
      const trades = await client.getUserTrades(filters);
      return formatResponse('Fetched user trades.', trades);
    }
  );

  server.registerTool(
    'getOrder',
    {
      title: 'Get Order',
      description: 'Retrieve a specific order by ID.',
      inputSchema: z.object({
        orderId: z.string().describe('HollaEx Network order ID'),
      }),
      outputSchema: orderOutputSchema,
    },
    async ({ orderId }) => {
      const client = makeClient();
      const order = await client.getOrder(orderId);
      return formatResponse(`Fetched order ${orderId}.`, order);
    }
  );

  server.registerTool(
    'getOrders',
    {
      title: 'Get Orders',
      description:
        'Retrieve the list of user orders with optional filters (symbol, side, status).',
      inputSchema: z.object({
        symbol: z
          .string()
          .optional()
          .describe('Optional trading pair symbol, e.g. xht-usdt'),
        side: z.enum(['buy', 'sell']).optional().describe('Order side filter'),
        status: z.string().optional().describe('Order status filter'),
        open: z.boolean().optional().describe('Filter by open orders'),
        limit: z
          .number()
          .int()
          .positive()
          .max(50)
          .optional()
          .describe('Orders per page (max 50)'),
        page: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Page number (default 1)'),
        orderBy: z.string().optional().describe('Field to order by'),
        order: z.enum(['asc', 'desc']).optional().describe('Sort direction'),
        startDate: z
          .string()
          .optional()
          .describe('ISO8601 start date filter'),
        endDate: z
          .string()
          .optional()
          .describe('ISO8601 end date filter'),
      }),
      outputSchema: z.array(orderOutputSchema).or(genericOutputSchema),
    },
    async (filters) => {
      const client = makeClient();
      const orders = await client.getOrders(filters);
      return formatResponse('Fetched orders.', orders);
    }
  );

  server.registerTool(
    'cancelAllOrders',
    {
      title: 'Cancel All Orders',
      description:
        'Cancel all active orders for a specific trading pair symbol.',
      inputSchema: z.object({
        symbol: z
          .string()
          .describe('Trading pair symbol to cancel orders for, e.g. xht-usdt'),
      }),
      outputSchema: genericOutputSchema,
    },
    async ({ symbol }) => {
      const client = makeClient();
      const result = await client.cancelAllOrders(symbol);
      return formatResponse(`Canceled all orders for ${symbol}.`, result);
    }
  );

  server.registerTool(
    'getMiniCharts',
    {
      title: 'Get Mini Charts',
      description: 'Get trade history HOLCV for provided assets.',
      inputSchema: z.object({
        assets: z
          .array(z.string())
          .nonempty()
          .describe('List of asset symbols to fetch, e.g. ["xht", "btc"]'),
        from: z.string().optional().describe('ISO8601 start date'),
        to: z.string().optional().describe('ISO8601 end date'),
        quote: z
          .string()
          .optional()
          .describe('Optional quote asset to price against'),
      }),
      outputSchema: genericOutputSchema,
    },
    async ({ assets, from, to, quote }) => {
      const client = makeClient();
      const result = await client.getMiniCharts(assets, {
        from,
        to,
        quote,
        assets,
      });
      return formatResponse('Fetched mini charts.', result);
    }
  );

  server.registerTool(
    'getQuickTradeQuote',
    {
      title: 'Get Quick Trade Quote',
      description: 'Get a quick trade quote between two currencies.',
      inputSchema: z.object({
        spending_currency: z
          .string()
          .describe('Currency symbol of the spending currency'),
        receiving_currency: z
          .string()
          .describe('Currency symbol of the receiving currency'),
        spending_amount: z
          .union([z.string(), z.number()])
          .optional()
          .describe('Optional spending amount; provide this or receiving_amount'),
        receiving_amount: z
          .union([z.string(), z.number()])
          .optional()
          .describe('Optional receiving amount; provide this or spending_amount'),
      }),
      outputSchema: genericOutputSchema,
    },
    async ({
      spending_currency,
      receiving_currency,
      spending_amount,
      receiving_amount,
    }) => {
      const client = makeClient();
      const result = await client.getQuickTradeQuote(
        spending_currency,
        receiving_currency,
        {
          spending_amount,
          receiving_amount,
        }
      );
      return formatResponse('Fetched quick trade quote.', result);
    }
  );

  server.registerTool(
    'executeOrder',
    {
      title: 'Execute Order',
      description: 'Execute a pre-created order using its token.',
      inputSchema: z.object({
        token: z.string().describe('Order execution token'),
      }),
      outputSchema: genericOutputSchema,
    },
    async ({ token }) => {
      const client = makeClient();
      const result = await client.executeOrder(token);
      return formatResponse('Executed order.', result);
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
