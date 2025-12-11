import { embeddingService } from '../services/EmbeddingService.js';
import { databaseService, SimilarityResult } from '../services/DatabaseService.js';
import { redisCache } from '../services/RedisCacheService.js';
import { firecrawlService, ScrapeOptions } from '../services/FirecrawlService.js';

export interface RagQueryOptions {
  topK?: number;
  similarityThreshold?: number;
  includeMetadata?: boolean;
}

export interface RagQueryResult {
  query: string;
  results: SimilarityResult[];
  context: string;
  citations: string[];
  metadata: {
    totalResults: number;
    averageSimilarity: number;
    queryEmbeddingDimensions: number;
  };
}

export interface DocumentInput {
  content: string;
  metadata?: Record<string, any>;
  source?: string;
}

/**
 * RAG Agent - Main interface for Retrieval-Augmented Generation
 */
export class RagAgent {
  private embeddingService = embeddingService;
  private databaseService = databaseService;
  private isInitialized: boolean = false;

  constructor() {}

  /**
   * Initialize the RAG agent
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.log('RAG Agent already initialized');
      return;
    }

    try {
      console.log('Initializing RAG Agent...');
      
      // Initialize Redis cache
      await redisCache.connect();
      
      // Initialize embedding service
      await this.embeddingService.initialize();
      
      // Initialize database schema
      await this.databaseService.initializeSchema();
      
      this.isInitialized = true;
      console.log('✓ RAG Agent initialized successfully');
    } catch (error) {
      console.error('Failed to initialize RAG Agent:', error);
      throw error;
    }
  }

  /**
   * Query the RAG system
   */
  public async query(
    queryText: string,
    options: RagQueryOptions = {}
  ): Promise<RagQueryResult> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const {
      topK = parseInt(process.env['SIMILARITY_SEARCH_K'] || '5'),
      similarityThreshold = 0.7,
      includeMetadata = true,
    } = options;

    // Check cache first
    const cacheKey = redisCache.generateKey('query', queryText, topK.toString());
    const cached = await redisCache.get(cacheKey);
    if (cached) {
      console.log('✓ Cache hit for query');
      return cached;
    }

    try {
      // Generate query embedding
      console.log(`Generating embedding for query: "${queryText}"`);
      const { embedding, dimensions } = await this.embeddingService.generateEmbedding(queryText);

      // Search for similar documents
      console.log(`Searching for similar documents (top ${topK})...`);
      const results = await this.databaseService.searchSimilar(
        embedding,
        topK,
        similarityThreshold
      );

      // Build context from results
      const context = this.buildContext(results);
      const citations = this.extractCitations(results);

      // Calculate metadata
      const averageSimilarity = results.length > 0
        ? results.reduce((sum, r) => sum + r.similarity, 0) / results.length
        : 0;

      const result: RagQueryResult = {
        query: queryText,
        results: includeMetadata ? results : results.map(r => ({
          ...r,
          metadata: undefined,
        })),
        context,
        citations,
        metadata: {
          totalResults: results.length,
          averageSimilarity,
          queryEmbeddingDimensions: dimensions,
        },
      };

      // Cache the result
      await redisCache.set(cacheKey, result);

      return result;
    } catch (error) {
      console.error('Query failed:', error);
      throw new Error(`RAG query failed: ${error}`);
    }
  }

  /**
   * Add a single document to the RAG system
   */
  public async addDocument(document: DocumentInput): Promise<string> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      // Generate embedding
      const { embedding } = await this.embeddingService.generateEmbedding(document.content);

      // Insert into database
      const documentId = await this.databaseService.insertDocument(
        document.content,
        embedding,
        document.metadata,
        document.source
      );

      console.log(`✓ Document added successfully: ${documentId}`);
      return documentId;
    } catch (error) {
      console.error('Failed to add document:', error);
      throw error;
    }
  }

  /**
   * Add multiple documents in batch
   */
  public async addDocuments(documents: DocumentInput[]): Promise<string[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      console.log(`Generating embeddings for ${documents.length} documents...`);
      
      // Generate embeddings
      const embeddings = await this.embeddingService.generateEmbeddings(
        documents.map(d => d.content)
      );

      // Prepare documents with embeddings
      const documentsWithEmbeddings = documents.map((doc, index) => ({
        content: doc.content,
        embedding: embeddings[index]!.embedding,
        metadata: doc.metadata,
        source: doc.source,
      }));

      // Batch insert
      const documentIds = await this.databaseService.batchInsertDocuments(
        documentsWithEmbeddings
      );

      console.log(`✓ Added ${documentIds.length} documents successfully`);
      return documentIds;
    } catch (error) {
      console.error('Failed to add documents:', error);
      throw error;
    }
  }

  /**
   * Delete a document from the RAG system
   */
  public async deleteDocument(documentId: string): Promise<boolean> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    return await this.databaseService.deleteDocument(documentId);
  }

  /**
   * Get total document count
   */
  public async getDocumentCount(): Promise<number> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    return await this.databaseService.getDocumentCount();
  }

  /**
   * Build context string from search results
   */
  private buildContext(results: SimilarityResult[]): string {
    if (results.length === 0) {
      return 'No relevant context found.';
    }

    return results
      .map((result, index) => {
        const source = result.source ? ` [Source: ${result.source}]` : '';
        return `[${index + 1}] ${result.content}${source}`;
      })
      .join('\n\n');
  }

  /**
   * Extract citations from search results
   */
  private extractCitations(results: SimilarityResult[]): string[] {
    return results
      .filter(r => r.source)
      .map(r => r.source!)
      .filter((value, index, self) => self.indexOf(value) === index); // Unique sources
  }

  /**
   * Get agent status
   */
  public getStatus(): {
    initialized: boolean;
    embeddingModel: string;
  } {
    return {
      initialized: this.isInitialized,
      embeddingModel: this.embeddingService.getModelInfo().name,
    };
  }

  /**
   * Cleanup resources
   */
  public async cleanup(): Promise<void> {
    await this.embeddingService.cleanup();
    await this.databaseService.close();
    await redisCache.disconnect();
    this.isInitialized = false;
    console.log('RAG Agent cleaned up');
  }

  /**
   * Scrape and index a website
   */
  public async indexWebsite(
    url: string,
    options?: ScrapeOptions
  ): Promise<{ documentIds: string[]; pageCount: number }> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    console.log(`Scraping website: ${url}`);
    const pages = await firecrawlService.crawlWebsite(url, options);
    
    console.log(`Converting ${pages.length} pages to documents...`);
    const documents = firecrawlService.pagesToDocuments(pages);
    
    console.log(`Indexing ${documents.length} documents...`);
    const documentIds = await this.addDocuments(documents);
    
    return {
      documentIds,
      pageCount: pages.length,
    };
  }
}

// Export singleton instance
export const ragAgent = new RagAgent();
