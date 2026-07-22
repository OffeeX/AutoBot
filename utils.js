const dns = require('dns');
const net = require('net');
const fs = require('fs').promises;
const https = require('https');
const settings = require('./settings.json');

async function checkServerStatus(ip, port) {
  try {
    const { pingJava } = await import('@minescope/mineping');

    const data = await Promise.race([
      pingJava(ip, { port, timeout: settings.serverCheckTimeout }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Тайм-аут проверки сервера')), settings.serverCheckTimeout + 1000))
    ]);

    const players = data.players?.sample?.map(p => p.name) || [];
    const version = data.version?.name || 'unknown';

    return {
      isOnline: true,
      players,
      version,
      status: `online: ${data.players?.online || 0} players, version: ${version}`
    };
  } catch (err) {
    return {
      isOnline: false,
      players: [],
      version: null,
      status: `Ошибка ping: ${err.message}`
    };
  }
}

async function checkNetwork() {
  try {
    console.log('[Diagnostics] Checking network...');
    
    try {
      const addresses = await dns.promises.lookup('google.com');
    } catch (dnsErr) {
      console.log(`[Сеть] DNS недоступен: ${dnsErr.message}`);
    }

    await new Promise((resolve) => {
      const testSocket = net.createConnection(80, 'google.com', () => {
        console.log('[Net] HTTP connection is possible');
        testSocket.destroy();
        resolve();
      });
      
      testSocket.on('error', (err) => {
        console.log(`[Net] HTTP connection unavailable: ${err.code || err.message}`);
        resolve();
      });
      
      testSocket.setTimeout(5000, () => {
        console.log('[Net] HTTP test timeout');
        testSocket.destroy();
        resolve();
      });
    });
    
    console.log('[Diagnostics] Network check complete');
  } catch (err) {
    console.log(`[Diagnostics] General network error: ${err.message}`);
  }
}

async function loadFile(file, delimiter = '\n', errorMsg = 'Файл пуст') {
  try {
    const content = await fs.readFile(file, 'utf-8');
    const items = content.trim().split(delimiter).map(item => item.trim()).filter(Boolean);
    if (!items.length) throw new Error(errorMsg);
    return items;
  } catch (err) {
    console.error(`[File] Could not read ${file}: ${err.message}`);
    throw err;
  }
}

function sanitizeString(str) {
  if (typeof str !== 'string') return 'unknown';
  return str.replace(/[\x00-\x1F\x7F-\x9F]/g, '').replace(/[^\x20-\x7E\u0400-\u04FF]/g, '').trim() || 'unknown';
}

async function sendToWebhook(message) {
  const webhook = settings.webhook;
  if (!webhook) {
    console.log('[Webhook] URL not specified');
    return;
  }

  console.log(`[Webhook] Dispatch: ${message.substring(0, 100)}...`);
  
  if (message.length > 2000) {
    console.log('[Webhook] Message truncated to 2,000 characters.');
    message = message.substring(0, 2000);
  }

  let data;
  try {
    data = JSON.stringify({ content: message });
  } catch (err) {
    console.error(`[Webhook] Error JSON: ${err.message}`);
    return;
  }

  try {
    const url = new URL(webhook);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'Content-Length': Buffer.byteLength(data) 
      },
      timeout: 10000
    };

    return await new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let responseBody = '';
        res.on('data', (chunk) => (responseBody += chunk));
        res.on('end', () => {
          if (res.statusCode === 204) {
            console.log('[Webhook] Sent successfully');
            resolve();
          } else {
            console.log(`[Webhook] Answer: ${res.statusCode} - ${responseBody}`);
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      });
      
      req.on('error', (err) => {
        console.log(`[Webhook] Request error: ${err.message}`);
        reject(err);
      });
      
      req.on('timeout', () => {
        console.log('[Webhook] Request timeout');
        req.destroy();
        reject(new Error('Timeout'));
      });
      
      req.write(data);
      req.end();
    });
  } catch (err) {
    console.error(`[Webhook] General error: ${err.message}`);
    if (err.message.includes('Invalid URL')) {
      console.error(`[Webhook] Check the URL: ${webhook}`);
    }
  }
}

module.exports = {
  checkNetwork,
  loadFile,
  checkServerStatus,
  sanitizeString,
  sendToWebhook
};
