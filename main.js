const fs = require('fs').promises;
const { checkNetwork, loadFile, checkServerStatus } = require('./utils');
const { operateBot } = require('./bot');
const settings = require('./settings.json');

async function log(msg) {
  console.log(msg);
}

function isValidServerHost(host) {
  if (!host || host.length > 255) return false;
  if (/[\s,а-яА-Я\u0400-\u04FF]/.test(host)) return false;
  const ipv4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
  const hostname = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;
  return ipv4.test(host) || hostname.test(host);
}

async function processServer(server, commands, count) {
  const [ip, portStr] = server.split(':');
  const port = parseInt(portStr);

  if (!ip || isNaN(port) || !isValidServerHost(ip)) {
    await log(`[Error] Invalid server format: ${server}`);
    return count;
  }

  await log(`[Processing] Server check: ${ip}:${port}`);

  let isOnline, status, players, version;
  try {
    const result = await Promise.race([
      checkServerStatus(ip, port),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Server check timeout')), settings.serverCheckTimeout))
    ]);
    ({ isOnline, status, players, version } = result);
  } catch (err) {
    await log(`[Error] Could not verify the server ${ip}:${port}: ${err.message}`);
    return count;
  }

  await log(status);

  if (!isOnline) {
    await log(`[Pass] Server ${ip}:${port} unavailable`);
    return count;
  }

  if (!players.length) {
    await log(`[Pass] On the server ${ip}:${port} No players in the list.`);
    return count;
  }

  for (const player of players) {
    let result;
    try {
      result = await operateBot(ip, port, player, commands, server, version);
    } catch (err) {
      await log(`[Error] Worker error for ${player}: ${err.message}`);
      result = { skipServer: false, botSuccess: false };
    }

    const { skipServer, botSuccess } = result;
    if (botSuccess) {
      count++;
      await fs.writeFile('count.txt', count.toString()).catch(() => {});
    }

    if (skipServer) {
      await log(`[Information] Server skip ${ip}:${port} completed`);
      break;
    }
  }
  return count;
}

(async () => {
  try {
    let count = 0;
    try {
      const countStr = await fs.readFile('count.txt', 'utf-8');
      count = parseInt(countStr.trim()) || 0;
    } catch {}

    await checkNetwork();

    const commands = await loadFile('commands.txt', '\n');

    await log(`[Loading] Loaded: ${commands.length} teams`);

    const servers = await loadFile('servers.txt', '\n', 'Файл servers.txt пуст');
    await log(`[Loading] Loaded: ${servers.length} servers`);

    for (const server of servers) {
      count = await processServer(server, commands, count);
    }

    await log(`[Conclusion] All the servers are full`);
    process.exit(0);
  } catch (err) {
    console.error(`[Critical error] ${err.message}`);
    process.exit(1);
  }
})();