import { pipeline, env } from '@xenova/transformers';
import fs from 'fs/promises';
import { getEnv } from '../config/environment.js';
import { OpenAIEmbeddingService } from './OpenAIEmbeddingService.js';

// Configure model cache directory
env.cacheDir = process.env['MODEL_CACHE_DIR'] || './models';

export interface EmbeddingResult {
  embedding: number[];
  dimensions: number;
  model: string;
}

export class EmbeddingService {
  private static instance: EmbeddingService;
  private pipeline: any = null;
  private modelName: string;
  private isInitialized: boolean = false;
  private provider: 'local' | 'openai';
  private openAIService?: OpenAIEmbeddingService;

  private constructor() {
    const config = getEnv();
    this.provider = config.EMBEDDING_PROVIDER;
    this.modelName = process.env['EMBEDDING_MODEL'] || 'Xenova/all-MiniLM-L6-v2';

    if (this.provider === 'openai') {
      this.openAIService = OpenAIEmbeddingService.getInstance();
    }
  }

  public static getInstance(): EmbeddingService {
    if (!EmbeddingService.instance) {
      EmbeddingService.instance = new EmbeddingService();
    }
    return EmbeddingService.instance;
  }

  /**
   * Initialize the embedding model (only for local provider)
   */
  public async initialize(): Promise<void> {
    if (this.provider === 'openai') {
      console.log('Using OpenAI embedding service');
      this.isInitialized = true;
      return;
    }

    if (this.isInitialized) {
      console.log('Embedding service already initialized');
      return;
    }

    try {
      console.log(`Loading local embedding model: ${this.modelName}...`);
      
      // Ensure cache directory exists
      await fs.mkdir(env.cacheDir, { recursive: true });

      // Load the feature extraction pipeline
      this.pipeline = await pipeline('feature-extraction', this.modelName);
      
      this.isInitialized = true;
      console.log(`✓ Local embedding model loaded successfully`);
    } catch (error) {
      console.error('Failed to initialize embedding service:', error);
      throw new Error(`Embedding service initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate embedding for a single text
   */
  public async generateEmbedding(text: string): Promise<EmbeddingResult> {
    if (!text || text.trim().length === 0) {
      throw new Error('Text cannot be empty');
    }

    // Use OpenAI service if provider is 'openai'
    if (this.provider === 'openai' && this.openAIService) {
      return this.openAIService.generateEmbedding(text);
    }

    // Use local model
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      // Generate embedding
      const output = await this.pipeline(text, {
        pooling: 'mean',
        normalize: true,
      });

      // Extract the embedding array
      const embedding = Array.from(output.data) as number[];

      return {
        embedding,
        dimensions: embedding.length,
        model: this.modelName,
      };
    } catch (error) {
      console.error('Error generating embedding:', error);
      throw new Error(`Failed to generate embedding: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate embeddings for multiple texts (batch processing)
   */
  public async generateEmbeddings(texts: string[]): Promise<EmbeddingResult[]> {
    if (!texts || texts.length === 0) {
      throw new Error('Texts array cannot be empty');
    }

    // Use OpenAI service if provider is 'openai'
    if (this.provider === 'openai' && this.openAIService) {
      return this.openAIService.generateEmbeddings(texts);
    }

    // Use local model
    if (!this.isInitialized) {
      await this.initialize();
    }

    const maxBatchSize = parseInt(process.env['MAX_BATCH_SIZE'] || '100');
    const results: EmbeddingResult[] = [];

    // Process in batches
    for (let i = 0; i < texts.length; i += maxBatchSize) {
      const batch = texts.slice(i, i + maxBatchSize);
      console.log(`Processing batch ${Math.floor(i / maxBatchSize) + 1}/${Math.ceil(texts.length / maxBatchSize)}...`);

      const batchResults = await Promise.all(
        batch.map(text => this.generateEmbedding(text))
      );

      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Get model information
   */
  public getModelInfo(): { name: string; initialized: boolean; provider: string } {
    return {
      name: this.provider === 'openai' ? (this.openAIService?.getModel() || 'openai') : this.modelName,
      initialized: this.isInitialized,
      provider: this.provider,
    };
  }

  /**
   * Get embedding dimensions
   */
  public getDimensions(): number {
    if (this.provider === 'openai' && this.openAIService) {
      return this.openAIService.getDimensions();
    }
    // Default for Xenova/all-MiniLM-L6-v2
    return 384;
  }

  /**
   * Cleanup resources
   */
  public async cleanup(): Promise<void> {
    if (this.pipeline) {
      this.pipeline = null;
      this.isInitialized = false;
      console.log('Embedding service cleaned up');
    }
  }
}

// Export singleton instance
export const embeddingService = EmbeddingService.getInstance();
