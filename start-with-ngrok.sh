#!/bin/bash

# Start local development server with ngrok tunnel
# This exposes your local server to the internet for VAPI testing

set -e

echo "🚀 Starting local server with ngrok tunnel..."
echo ""

# Check if ngrok is installed
if ! command -v ngrok &> /dev/null; then
    echo "❌ ngrok is not installed. Please install it first:"
    echo "   brew install ngrok"
    echo "   or visit: https://ngrok.com/download"
    exit 1
fi

# Check if ngrok is authenticated
if ! ngrok config check &> /dev/null; then
    echo "⚠️  ngrok not authenticated. Please run:"
    echo "   ngrok authtoken YOUR_AUTHTOKEN"
    echo "   Get your authtoken from: https://dashboard.ngrok.com/get-started/your-authtoken"
    exit 1
fi

# Set default port
PORT=${PORT:-3000}

echo "📋 Configuration:"
echo "  Local Port: $PORT"
echo "  Node.js Environment: ${NODE_ENV:-development}"
echo ""

# Start the development server in the background
echo "🔧 Starting Node.js server on port $PORT..."
npm run dev &
SERVER_PID=$!

# Wait a moment for server to start
echo "⏳ Waiting for server to start..."
sleep 3

# Check if server is running
if ! lsof -i :$PORT &> /dev/null; then
    echo "❌ Server failed to start on port $PORT"
    kill $SERVER_PID 2>/dev/null || true
    exit 1
fi

echo "✅ Server started successfully"
echo ""

# Start ngrok tunnel
echo "🌐 Starting ngrok tunnel..."
ngrok http $PORT --log=stdout > ngrok.log 2>&1 &
NGROK_PID=$!

# Wait for ngrok to start
echo "⏳ Waiting for ngrok tunnel..."
sleep 5

# Get the ngrok URL
NGROK_URL=""
for i in {1..10}; do
    NGROK_URL=$(curl -s http://localhost:4040/api/tunnels | jq -r '.tunnels[0].public_url' 2>/dev/null || echo "")
    if [[ $NGROK_URL != "" && $NGROK_URL != "null" ]]; then
        break
    fi
    echo "⏳ Still waiting for ngrok... (attempt $i/10)"
    sleep 2
done

if [[ $NGROK_URL == "" || $NGROK_URL == "null" ]]; then
    echo "❌ Failed to get ngrok URL"
    kill $SERVER_PID $NGROK_PID 2>/dev/null || true
    exit 1
fi

echo ""
echo "🎉 Setup complete!"
echo ""
echo "📋 Server Details:"
echo "  Local URL: http://localhost:$PORT"
echo "  Public URL: $NGROK_URL"
echo "  Health Check: $NGROK_URL/health"
echo ""
echo "🔧 VAPI Endpoints:"
echo "  Webhook: $NGROK_URL/api/vapi/webhook"
echo "  Get User Info: $NGROK_URL/api/vapi/get-user-info"
echo "  Negotiate: $NGROK_URL/api/vapi/negotiate"
echo "  Save Result: $NGROK_URL/api/vapi/save-result"
echo ""
echo "🚀 Deploy VAPI Agent:"
echo "  SERVER_URL=\"$NGROK_URL\" ./deploy-simple.sh"
echo ""
echo "📊 Monitoring:"
echo "  Ngrok Dashboard: http://localhost:4040"
echo "  Server Logs: Check this terminal"
echo ""
echo "⚠️  Important Notes:"
echo "  - Keep this terminal open to maintain the tunnel"
echo "  - The ngrok URL changes each time you restart (unless you have a paid plan)"
echo "  - Test your endpoints before deploying the VAPI agent"
echo ""

# Save the ngrok URL for the deployment script
echo "export SERVER_URL=\"$NGROK_URL\"" > .ngrok-url
echo "💾 Ngrok URL saved to .ngrok-url"
echo ""

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "🛑 Shutting down..."
    kill $SERVER_PID $NGROK_PID 2>/dev/null || true
    rm -f ngrok.log .ngrok-url
    echo "✅ Cleanup complete"
}

# Set trap to cleanup on script exit
trap cleanup EXIT INT TERM

echo "✨ Ready to test! Press Ctrl+C to stop both server and tunnel"
echo ""

# Wait for user to stop
wait $SERVER_PID
