'use strict';

// =====================================================================
// Groq + tbp Telegram Bot
// - Chat এ বললে Groq বুঝবে কি করতে হবে
// - tbp দিয়ে browser চালাবে
// - Proxy: Xray/VMess support (YT Studio এর same pattern)
// =====================================================================

const TelegramBot = require('node-telegram-bot-api');
const Groq = require('groq-sdk');
const { tbp } = require('./tbp_client');
const { startXray } = require('./xray');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const ALLOWED_USERS = (process.env.ALLOWED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

if (!TOKEN) throw new Error('TELEGRAM_BOT_TOKEN missing');
if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY missing');

const bot = new TelegramBot(TOKEN, { polling: true });
const groq = new Groq({ apiKey: GROQ_API_KEY });

// Xray start করো যদি VMESS_LINK থাকে
startXray();

// conversation history per user
const history = {};

// ---- tbp tools definition for Groq ----
const tools = [
  {
    type: 'function',
    function: {
      name: 'browser_goto',
      description: 'একটা URL এ navigate করো',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL' },
          cloudflare_bypass: { type: 'boolean', description: 'Cloudflare bypass করতে হবে?' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_click',
      description: 'Page এ কোনো element click করো (CSS selector দিয়ে)',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector যেমন .play-btn বা #submit' }
        },
        required: ['selector']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_type',
      description: 'Input field এ text type করো',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string' },
          text: { type: 'string' }
        },
        required: ['selector', 'text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_get_links',
      description: 'Page এর সব links বের করো',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_get_text',
      description: 'Page এর text content পড়ো',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_screenshot',
      description: 'Page এর screenshot নাও',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_network_capture',
      description: 'Network requests capture করো — video URL বের করার জন্য। start=true মানে শুরু করো, start=false মানে logs দেখাও',
      parameters: {
        type: 'object',
        properties: {
          start: { type: 'boolean', description: 'true=capture শুরু, false=logs দেখাও' }
        },
        required: ['start']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_eval',
      description: 'Page এ JavaScript run করো',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'JavaScript code' }
        },
        required: ['code']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_wait',
      description: 'কিছুক্ষণ অপেক্ষা করো',
      parameters: {
        type: 'object',
        properties: {
          seconds: { type: 'number', description: 'কত সেকেন্ড' }
        },
        required: ['seconds']
      }
    }
  }
];

// ---- Tool executor ----
async function executeTool(name, args) {
  switch (name) {
    case 'browser_goto': {
      const flags = args.cloudflare_bypass ? ['-cf'] : [];
      return await tbp(['goto', args.url, ...flags]);
    }
    case 'browser_click':
      return await tbp(['click', args.selector]);
    case 'browser_type':
      return await tbp(['type', args.selector, args.text]);
    case 'browser_get_links':
      return await tbp(['links']);
    case 'browser_get_text':
      return await tbp(['text']);
    case 'browser_screenshot': {
      const path = `/tmp/screenshot_${Date.now()}.png`;
      await tbp(['screenshot', path]);
      return { screenshot_path: path };
    }
    case 'browser_network_capture':
      if (args.start) {
        await tbp(['network', 'clear']);
        return await tbp(['network', 'start']);
      } else {
        return await tbp(['network', 'logs']);
      }
    case 'browser_eval':
      return await tbp(['eval', args.code]);
    case 'browser_wait':
      return await tbp(['wait', String(args.seconds)]);
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ---- Agentic loop ----
async function runAgent(userId, userMessage) {
  if (!history[userId]) history[userId] = [];

  history[userId].push({ role: 'user', content: userMessage });

  const messages = [
    {
      role: 'system',
      content: `তুমি একটা AI agent যে browser automation করতে পারো। 
তোমার কাছে tbp (Termux Browser Pilot) tools আছে।
User বাংলা বা English যেকোনো ভাষায় বলতে পারবে।
Video URL বের করতে হলে: goto → network_capture(start=true) → click play → wait → network_capture(start=false) → logs analyze করো।
mp4, m3u8, .ts links গুলো video URL।
সংক্ষেপে কাজ করো, unnecessary steps বাদ দাও।`
    },
    ...history[userId]
  ];

  let response = await groq.chat.completions.create({
    model: 'openai/gpt-oss-120b',
    messages,
    tools,
    tool_choice: 'auto',
      parallel_tool_calls: false,
    temperature: 0,
    max_tokens: 2048
  });

  let assistantMessage = response.choices[0].message;
  history[userId].push(assistantMessage);

  // Agentic loop — tool calls শেষ না হওয়া পর্যন্ত চলবে
  while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
    const toolResults = [];

    for (const tc of assistantMessage.tool_calls) {
      const args = JSON.parse(tc.function.arguments);
      console.log(`[Tool] ${tc.function.name}`, args);

      const result = await executeTool(tc.function.name, args);
      toolResults.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(result)
      });
    }

    history[userId].push(...toolResults);

    response = await groq.chat.completions.create({
      model: 'openai/gpt-oss-120b',
      messages: [messages[0], ...history[userId]],
      tools,
      tool_choice: 'auto',
      parallel_tool_calls: false,
      temperature: 0,
      max_tokens: 2048
    });

    assistantMessage = response.choices[0].message;
    history[userId].push(assistantMessage);
  }

  // History 20 messages এ রাখো (memory save)
  if (history[userId].length > 20) {
    history[userId] = history[userId].slice(-20);
  }

  return assistantMessage.content || 'কাজ হয়ে গেছে।';
}

// ---- Telegram handlers ----
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const text = msg.text;

  if (!text) return;

  // Allowed users check
  if (ALLOWED_USERS.length > 0 && !ALLOWED_USERS.includes(userId)) {
    return bot.sendMessage(chatId, '❌ Access denied.');
  }

  if (text === '/start') {
    return bot.sendMessage(chatId, `🤖 Groq + tbp Bot চালু আছে!\n\nযা বলবি তাই করবো। যেমন:\n• "movie-box.co তে গিয়ে Where is Home এর video link বের করো"\n• "google.com এ Python tutorial সার্চ করো"\n\n/clear — conversation reset`);
  }

  if (text === '/clear') {
    history[userId] = [];
    return bot.sendMessage(chatId, '🗑️ Conversation cleared।');
  }

  // Typing indicator
  bot.sendChatAction(chatId, 'typing');

  try {
    const reply = await runAgent(userId, text);

    // Screenshot পাঠাও যদি থাকে
    if (reply.includes('screenshot_path')) {
      const match = reply.match(/screenshot_path["\s:]+([^\s,"]+)/);
      if (match) {
        await bot.sendPhoto(chatId, match[1]).catch(() => {});
      }
    }

    await bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error(err);
    await bot.sendMessage(chatId, `❌ Error: ${err.message}`);
  }
});

console.log('🤖 Groq+tbp bot started');
