// Vercel serverless entrypoint for MCP HTTP transport.
const { createHttpApp } = require('../src/mcp-server');

const app = createHttpApp();

module.exports = app;
