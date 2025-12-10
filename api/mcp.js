// Vercel serverless entrypoint for MCP HTTP transport.
// Export a handler function so Vercel can invoke the Express app.
const { createHttpApp } = require('../src/mcp-server');
const app = createHttpApp();

module.exports = (req, res) => app(req, res);
