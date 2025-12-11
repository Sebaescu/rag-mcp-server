/**
 * Enhanced MCP Server for RAG System
 * 
 * Provides Model Context Protocol interface with HTTP health checks and metrics.
 * Features:
 * - MCP tools for RAG operations
 * - HTTP health check endpoint
 * - Metrics endpoint
 * - Graceful shutdown
 * - Request tracking
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import http from 'http';
import { ragAgent } from './agents/RagAgent.js';
import { getEnv, validateEnvironment } from './config/environment.js';
import { dbPool } from './config/database.js';

// Validate environment on startup
validateEnvironment();
const env = getEnv();

// Metrics tracking
const metrics = {
  requestCount: 0,
  errorCount: 0,
  startTime: Date.now(),
};

// MCP Tool Definitions
const tools: Tool[] = [
  {
    name: 'rag_query',
    description: 'Query the RAG system for relevant information. Returns documents ranked by semantic similarity.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query text',
        },
        topK: {
          type: 'number',
          description: 'Number of results to return (default: 5)',
          default: 5,
        },
        similarityThreshold: {
          type: 'number',
          description: 'Minimum similarity score 0-1 (default: 0.7)',
          default: 0.7,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'rag_add_document',
    description: 'Add a single document to the RAG system for semantic search.',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The document text content',
        },
        metadata: {
          type: 'object',
          description: 'Optional metadata (source, tags, etc.)',
          additionalProperties: true,
        },
      },
      required: ['content'],
    },
  },
  {
    name: 'rag_add_documents',
    description: 'Add multiple documents to the RAG system in batch (efficient bulk operation).',
    inputSchema: {
      type: 'object',
      properties: {
        documents: {
          type: 'array',
          description: 'Array of documents to add',
          items: {
            type: 'object',
            properties: {
              content: {
                type: 'string',
                description: 'The document text content',
              },
              metadata: {
                type: 'object',
                description: 'Optional metadata',
                additionalProperties: true,
              },
            },
            required: ['content'],
          },
        },
      },
      required: ['documents'],
    },
  },
  {
    name: 'rag_delete_document',
    description: 'Delete a document from the RAG system by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: {
          type: 'number',
          description: 'The ID of the document to delete',
        },
      },
      required: ['documentId'],
    },
  },
  {
    name: 'rag_index_website',
    description: 'Scrape and index an entire website. Crawls pages recursively and adds them to the RAG system.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The website URL to scrape',
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum crawl depth (default: 2)',
          default: 2,
        },
        maxPages: {
          type: 'number',
          description: 'Maximum number of pages to scrape (default: 50)',
          default: 50,
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'rag_get_stats',
    description: 'Get statistics about the RAG system (document count, cache info, etc.).',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// Initialize MCP Server
const server = new Server(
  {
    name: 'rag-system',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  metrics.requestCount++;

  try {
    // Initialize RAG agent if needed
    if (!ragAgent['isInitialized']) {
      await ragAgent.initialize();
    }

    switch (name) {
      case 'rag_query': {
        const { query, topK, similarityThreshold } = args as {
          query: string;
          topK?: number;
          similarityThreshold?: number;
        };

        const result = await ragAgent.query(query, {
          topK,
          similarityThreshold,
          includeMetadata: true,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'rag_add_document': {
        const { content, metadata } = args as {
          content: string;
          metadata?: Record<string, any>;
        };

        const documentId = await ragAgent.addDocument({
          content,
          metadata: metadata || {},
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ success: true, documentId }, null, 2),
            },
          ],
        };
      }

      case 'rag_add_documents': {
        const { documents } = args as {
          documents: Array<{ content: string; metadata?: Record<string, any> }>;
        };

        const documentIds = await Promise.all(
          documents.map(doc => ragAgent.addDocument(doc))
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  count: documentIds.length,
                  documentIds,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'rag_delete_document': {
        const { documentId } = args as { documentId: number };

        // Delete embeddings first (foreign key constraint)
        await dbPool.query('DELETE FROM rag.embeddings WHERE document_id = $1', [documentId]);
        
        // Delete document
        const result = await dbPool.query(
          'DELETE FROM rag.documents WHERE id = $1 RETURNING id',
          [documentId]
        );

        if (result.rows.length === 0) {
          throw new Error(`Document with ID ${documentId} not found`);
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                { success: true, documentId, message: 'Document deleted' },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'rag_index_website': {
        const { url, maxDepth, maxPages } = args as {
          url: string;
          maxDepth?: number;
          maxPages?: number;
        };

        const result = await ragAgent.indexWebsite(url, {
          maxDepth,
          maxPages,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  ...result,
                  message: `Indexed ${result.pageCount} pages from ${url}`,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'rag_get_stats': {
        const result = await dbPool.query(
          'SELECT COUNT(*) as count FROM rag.documents'
        );

        const embeddingResult = await dbPool.query(
          'SELECT COUNT(*) as count FROM rag.embeddings'
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  documentCount: parseInt(result.rows[0].count),
                  embeddingCount: parseInt(embeddingResult.rows[0].count),
                  embeddingProvider: env.EMBEDDING_PROVIDER,
                  embeddingModel: env.EMBEDDING_PROVIDER === 'openai' 
                    ? env.OPENAI_EMBEDDING_MODEL 
                    : 'Xenova/all-MiniLM-L6-v2',
                  database: 'PostgreSQL + PGVector',
                  cache: 'Redis DB 1',
                },
                null,
                2
              ),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    metrics.errorCount++;
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              error: true,
              message: error instanceof Error ? error.message : String(error),
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }
});

// Create HTTP server for health checks
const httpServer = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.url === '/health') {
    try {
      // Check database connection
      await dbPool.query('SELECT 1');
      
      const uptime = Math.floor((Date.now() - metrics.startTime) / 1000);
      
      res.writeHead(200);
      res.end(JSON.stringify({
        status: 'healthy',
        uptime,
        database: 'connected',
        timestamp: new Date().toISOString(),
      }));
    } catch (error) {
      res.writeHead(503);
      res.end(JSON.stringify({
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
      }));
    }
  } else if (req.url === '/metrics') {
    const uptime = Math.floor((Date.now() - metrics.startTime) / 1000);
    
    res.writeHead(200);
    res.end(JSON.stringify({
      requestCount: metrics.requestCount,
      errorCount: metrics.errorCount,
      uptime,
      errorRate: metrics.requestCount > 0 
        ? (metrics.errorCount / metrics.requestCount * 100).toFixed(2) + '%'
        : '0%',
    }));
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

// Graceful shutdown handler
async function shutdown(signal: string) {
  console.error(`\nReceived ${signal}, shutting down gracefully...`);
  
  try {
    // Close HTTP server
    httpServer.close(() => {
      console.error('HTTP server closed');
    });

    // Close database connections
    await dbPool.end();
    console.error('Database connections closed');

    // Cleanup RAG agent
    if (ragAgent['cleanup']) {
      await ragAgent['cleanup']();
    }

    console.error('Shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
}

// Register shutdown handlers
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Start servers
async function main() {
  console.error('Starting RAG MCP Server...');
  
  // Start HTTP server for health checks
  httpServer.listen(env.PORT, () => {
    console.error(`HTTP health check server listening on port ${env.PORT}`);
    console.error(`  Health: http://localhost:${env.PORT}/health`);
    console.error(`  Metrics: http://localhost:${env.PORT}/metrics`);
  });

  // Start MCP server on stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('RAG MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error in MCP server:', error);
  process.exit(1);
});
