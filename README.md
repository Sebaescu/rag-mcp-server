# RAG MCP Server
A production-ready **Retrieval-Augmented Generation (RAG)** server implementing the **Model Context Protocol (MCP)**. Built for seamless integration with AI assistants like Cline, providing powerful semantic search capabilities over your documents.

## ✨ Features

- 🔍 **Semantic Search**: Query documents using natural language with vector similarity
- 🌐 **Website Indexing**: Automatically crawl and index entire websites
- 🚀 **Dual Embedding Support**: Choose between local (Xenova transformers) or OpenAI embeddings
- 🐳 **Docker Ready**: Complete Docker Compose setup with PostgreSQL + pgvector and Redis
- 📊 **Health Monitoring**: Built-in health checks and metrics endpoints
- 🔄 **Batch Operations**: Efficient bulk document processing
- 💾 **Redis Caching**: Fast query results with intelligent caching
- 🛡️ **Production Grade**: Graceful shutdown, error handling, and comprehensive logging

## 🏗️ Architecture

```
┌─────────────┐
│   Cline AI  │
└──────┬──────┘
       │ MCP Protocol (stdio)
       ↓
┌─────────────────────────┐
│   RAG MCP Server        │
│  - Query Handler        │
│  - Document Manager     │
│  - Website Crawler      │
└──────┬──────────────────┘
       │
       ├──→ PostgreSQL + pgvector (Vector DB)
       ├──→ Redis (Cache Layer)
       └──→ Embedding Service (Local/OpenAI)
```

## 🚀 Quick Start

### Using Docker (Recommended)

1. **Clone and setup**:
```bash
git clone <your-repo-url>
cd rag-mcp-server
cp .env.example .env
```

2. **Configure environment**:
Edit `.env` and set your preferences:
```env
EMBEDDING_PROVIDER=local  # or 'openai'
OPENAI_API_KEY=sk-...     # only if using OpenAI
```

3. **Start services**:
```bash
npm run docker:up
```

4. **Verify health**:
```bash
curl http://localhost:3000/health
```

### Local Development

1. **Prerequisites**:
   - Node.js 20+
   - PostgreSQL 16 with pgvector
   - Redis 7+

2. **Install dependencies**:
```bash
npm install
```

3. **Setup database**:
```bash
psql -U postgres -f docker/init.sql
```

4. **Configure environment**:
```bash
cp .env.example .env
# Edit .env with your database credentials
```

5. **Build and run**:
```bash
npm run build
npm start
```

Or for development with hot reload:
```bash
npm run dev
```

## ⚙️ Configuration

### Embedding Providers

#### Local Embeddings (Default)
Uses [Xenova/transformers](https://github.com/xenova/transformers.js) for on-device embeddings:
```env
EMBEDDING_PROVIDER=local
```
- ✅ Free and private
- ✅ No API keys needed
- ✅ Works offline
- ⚠️ Lower quality than OpenAI
- ⚠️ Slower for large batches

#### OpenAI Embeddings
Uses OpenAI's embedding models for highest quality:
```env
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=sk-your-api-key
OPENAI_EMBEDDING_MODEL=text-embedding-3-small  # or text-embedding-3-large
```
- ✅ Best quality embeddings
- ✅ Fast batch processing
- ⚠️ Requires API key and costs money
- ⚠️ Sends data to OpenAI

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `EMBEDDING_PROVIDER` | `local` or `openai` | `local` |
| `OPENAI_API_KEY` | OpenAI API key (if provider=openai) | - |
| `OPENAI_EMBEDDING_MODEL` | OpenAI model name | `text-embedding-3-small` |
| `DB_HOST` | PostgreSQL host | `localhost` |
| `DB_PORT` | PostgreSQL port | `5432` |
| `DB_NAME` | Database name | `rag_db` |
| `DB_USER` | Database user | `rag_user` |
| `DB_PASSWORD` | Database password | - |
| `REDIS_HOST` | Redis host | `localhost` |
| `REDIS_PORT` | Redis port | `6379` |
| `REDIS_DB` | Redis database number | `1` |
| `PORT` | HTTP server port | `3000` |
| `NODE_ENV` | Environment | `production` |

## 🛠️ MCP Tools Reference

### `rag_query`
Query the RAG system for relevant documents.

**Parameters**:
- `query` (string, required): Search query
- `topK` (number, optional): Number of results (default: 5)
- `similarityThreshold` (number, optional): Minimum similarity 0-1 (default: 0.7)

**Example**:
```json
{
  "query": "How to deploy with Docker?",
  "topK": 3,
  "similarityThreshold": 0.75
}
```

### `rag_add_document`
Add a single document to the system.

**Parameters**:
- `content` (string, required): Document text
- `metadata` (object, optional): Custom metadata

**Example**:
```json
{
  "content": "Docker deployment guide...",
  "metadata": {
    "source": "docs",
    "tags": ["docker", "deployment"]
  }
}
```

### `rag_add_documents`
Batch add multiple documents (more efficient).

**Parameters**:
- `documents` (array, required): Array of document objects

**Example**:
```json
{
  "documents": [
    {"content": "First doc...", "metadata": {"tag": "intro"}},
    {"content": "Second doc...", "metadata": {"tag": "advanced"}}
  ]
}
```

### `rag_delete_document`
Delete a document by ID.

**Parameters**:
- `documentId` (number, required): Document ID to delete

### `rag_index_website`
Crawl and index an entire website.

**Parameters**:
- `url` (string, required): Website URL
- `maxDepth` (number, optional): Crawl depth (default: 2)
- `maxPages` (number, optional): Max pages to crawl (default: 50)

**Example**:
```json
{
  "url": "https://docs.example.com",
  "maxDepth": 3,
  "maxPages": 100
}
```

### `rag_get_stats`
Get system statistics and health information.

## 🏥 Health Checks & Monitoring

### Health Endpoint
```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "healthy",
  "uptime": 3600,
  "database": "connected",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### Metrics Endpoint
```bash
curl http://localhost:3000/metrics
```

Response:
```json
{
  "requestCount": 1247,
  "errorCount": 3,
  "uptime": 86400,
  "errorRate": "0.24%"
}
```

## 📦 Development Commands

```bash
npm run build        # Compile TypeScript to dist/
npm run dev          # Development mode with hot reload
npm start            # Start production server
npm test             # Run tests
npm run lint         # Run ESLint

# Docker commands
npm run docker:build # Build Docker image
npm run docker:up    # Start all services
npm run docker:down  # Stop all services
npm run docker:logs  # View server logs
```

## 🗄️ Database Schema

### Tables

**rag.documents**
- `id`: Primary key
- `content`: Document text
- `metadata`: JSONB metadata
- `source_url`: Origin URL
- `title`: Document title
- `created_at`, `updated_at`: Timestamps

**rag.embeddings**
- `id`: Primary key
- `document_id`: Foreign key to documents
- `embedding`: vector(384) - Embedding vector
- `created_at`, `updated_at`: Timestamps

### Indexes
- HNSW index on embeddings for fast vector similarity
- GIN index on metadata for JSON queries
- B-tree indexes on common query fields

## 🔧 Troubleshooting

### Database connection issues
```bash
# Check PostgreSQL is running
docker-compose ps

# Check database logs
docker-compose logs postgres
```

### Embedding model download issues
```bash
# Clear model cache
rm -rf models/

# Restart with fresh download
npm run docker:down && npm run docker:up
```

### Port conflicts
If port 3000, 5432, or 6379 is already in use, update `.env`:
```env
PORT=3001
DB_PORT=5433
REDIS_PORT=6380
```

## 📚 Learn More

- [Model Context Protocol](https://modelcontextprotocol.io/)
- [pgvector Documentation](https://github.com/pgvector/pgvector)
- [Xenova Transformers.js](https://github.com/xenova/transformers.js)
- [OpenAI Embeddings API](https://platform.openai.com/docs/guides/embeddings)



Built with ❤️ for the AI community
