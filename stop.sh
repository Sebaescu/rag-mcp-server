#!/bin/bash

# Stop RAG MCP Server

echo "🛑 Stopping RAG MCP Server..."

pkill -f "node dist/server.js" || echo "Server not running"
echo "✓ Server stopped"
