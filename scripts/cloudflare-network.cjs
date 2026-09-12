// Only loaded by the deployment CLI, never bundled into the Worker or frontend.
const { Agent, ProxyAgent, setGlobalDispatcher } = require('undici');

const proxy = process.env.CSU_DEPLOY_PROXY || process.env.https_proxy || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.HTTP_PROXY;
// Wrangler would otherwise replace this dispatcher and discard the TLS options.
for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
  delete process.env[key];
}

const options = {
  connections: 1,
  pipelining: 0, // Disable persistent connections on the affected deployment network.
  headersTimeout: 30000,
  bodyTimeout: 30000,
  connect: { timeout: 15000, maxCachedSessions: 0 },
};

// Certificate verification stays enabled for both direct and proxy connections.
setGlobalDispatcher(proxy
  ? new ProxyAgent({ ...options, uri: proxy, requestTls: { maxCachedSessions: 0 } })
  : new Agent(options));
