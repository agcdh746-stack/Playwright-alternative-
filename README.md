# Groq + tbp Bot

Telegram bot — Groq AI brain + tbp browser automation। সব একটা Docker image এ।

## Railway Deploy

1. GitHub এ repo বানাও
2. এই files push করো
3. Railway এ New Project → GitHub repo connect
4. Environment variables দাও:

```
TELEGRAM_BOT_TOKEN = BotFather থেকে নেওয়া token
GROQ_API_KEY = gsk_xxx (console.groq.com)
ALLOWED_USER_IDS = তোমার Telegram user ID
VMESS_LINK = vmess://xxx (optional — proxy)
```

5. Deploy!

## Example

Telegram এ বলো:
- "movie-box.co তে গিয়ে Where is Home এর video link বের করো"
- "google এ Python tutorial সার্চ করো"
- "/clear" — conversation reset
