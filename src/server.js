import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPage, renderReport, renderUnavailable } from './view.js';

const apiHosts = Object.freeze({
  'sandbox-us': 'https://api.sandbox.us.junction.com',
  'sandbox-eu': 'https://api.sandbox.eu.junction.com',
  'prod-us': 'https://api.us.junction.com',
  'prod-eu': 'https://api.eu.junction.com',
});
// Local test settings. Replace the API key before running against a real order.
// Never publish this file with a real key in it.
const localSettings = Object.freeze({
  apiKey: 'PASTE_TEAM_API_KEY_HERE',
  environment: 'sandbox-us',
  port: 3000,
});
const exampleOrderId = '11111111-1111-4111-8111-111111111111';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const stylesPath = fileURLToPath(new URL('./styles.css', import.meta.url));
const orderFixturePath = fileURLToPath(new URL('../fixtures/order.json', import.meta.url));
const reportFixturePath = fileURLToPath(new URL('../fixtures/clinical-report.json', import.meta.url));

function settings() {
  const demo = process.argv.includes('--demo');
  const region = localSettings.environment;
  const host = apiHosts[region];
  if (!host) throw new Error('Choose sandbox-us, sandbox-eu, prod-us, or prod-eu in localSettings.environment.');
  if (!demo && (!localSettings.apiKey || localSettings.apiKey === 'PASTE_TEAM_API_KEY_HERE')) {
    throw new Error('Set localSettings.apiKey in src/server.js before starting the app.');
  }
  const port = localSettings.port;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Set a valid TCP port in localSettings.port.');
  return { demo, host, key: localSettings.apiKey, port, region };
}

function send(response, status, body, contentType = 'text/html; charset=utf-8') {
  response.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
  response.end(body);
}

async function readForm(request) {
  if (!request.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) {
    throw new PublicError(415, 'Submit the order ID using the form.');
  }
  let body = '';
  for await (const chunk of request) {
    body += chunk.toString('utf8');
    if (body.length > 2048) throw new PublicError(413, 'The form is too large.');
  }
  const orderId = new URLSearchParams(body).get('order_id')?.trim() || '';
  if (!uuidPattern.test(orderId)) throw new PublicError(400, 'Enter a valid Junction order ID.');
  return orderId;
}

class PublicError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function getJson(host, key, path) {
  let response;
  try {
    response = await fetch(`${host}${path}`, {
      headers: { 'x-vital-api-key': key, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
  } catch {
    throw new PublicError(502, 'Junction could not be reached. Check the environment and try again.');
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new PublicError(502, 'Junction rejected the API key or this order is not accessible to the key.');
    }
    if (response.status === 404) throw new PublicError(404, 'The order or clinical report is not available.');
    if (response.status === 400) {
      const error = await response.json().catch(() => ({}));
      if (error.detail === 'This feature is not available to your team.') {
        throw new PublicError(400, 'Clinical report access is not available to this team.');
      }
      throw new PublicError(400, 'The clinical report is unavailable for this order. Check that it is a Labcorp order.');
    }
    throw new PublicError(502, `Junction returned HTTP ${response.status}.`);
  }
  try {
    return await response.json();
  } catch {
    throw new PublicError(502, 'Junction returned a response that is not JSON.');
  }
}

async function loadResult(orderId, config) {
  if (config.demo) {
    if (orderId !== exampleOrderId) throw new PublicError(404, `Demo mode only has order ${exampleOrderId}.`);
    const [order, clinical] = await Promise.all([readFile(orderFixturePath, 'utf8'), readFile(reportFixturePath, 'utf8')]);
    return { order: JSON.parse(order), clinical: JSON.parse(clinical) };
  }
  const order = await getJson(config.host, config.key, `/v3/order/${orderId}`);
  const clinical = await getJson(config.host, config.key, `/v3/order/${orderId}/clinical_report`);
  if (order.id !== orderId || clinical.order_id !== orderId) {
    throw new PublicError(502, 'Junction returned data for a different order ID.');
  }
  return { order, clinical };
}

export function createApp(config = settings()) {
  return createServer(async (request, response) => {
    try {
      const path = new URL(request.url || '/', 'http://localhost').pathname;
      if (request.method === 'GET' && path === '/styles.css') {
        send(response, 200, await readFile(stylesPath, 'utf8'), 'text/css; charset=utf-8');
      } else if (request.method === 'GET' && path === '/') {
        send(response, 200, renderPage('', { demo: config.demo, exampleOrderId }));
      } else if (request.method === 'POST' && path === '/report') {
        const orderId = await readForm(request);
        const { order, clinical } = await loadResult(orderId, config);
        send(response, 200, renderPage(renderReport(order, clinical), { demo: config.demo, orderId }));
      } else {
        send(response, 404, renderPage(renderUnavailable('Page not found.'), { demo: config.demo }));
      }
    } catch (error) {
      const publicError = error instanceof PublicError ? error : new PublicError(500, 'The result view could not be loaded.');
      send(response, publicError.status, renderPage(renderUnavailable(publicError.message), { demo: config.demo }));
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const config = settings();
    createApp(config).listen(config.port, '127.0.0.1', () => {
      console.log(`Result example listening at http://127.0.0.1:${config.port} (${config.demo ? 'demo' : config.region})`);
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
