#!/bin/bash

# Start RAG MCP Server
# Usage: ./start.sh [dev|prod]

MODE=${1:-prod}

echo "🚀 Starting RAG MCP Server in $MODE mode..."

if [ "$MODE" = "dev" ]; then
  npm run dev
else
  node dist/server.js
fi
