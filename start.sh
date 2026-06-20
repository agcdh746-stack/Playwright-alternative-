#!/bin/bash
set -e

echo "🚀 Starting services..."

# 1. Xvfb (virtual display — Firefox এর জন্য)
Xvfb :99 -screen 0 1280x720x24 -ac &
sleep 2
echo "✓ Xvfb started"

# 2. tbp daemon warm up
tbp goto about:blank > /dev/null 2>&1 &
sleep 4
echo "✓ tbp/Firefox started"

# 3. Groq+Telegram bot
echo "✓ Starting bot..."
exec node bot.js
