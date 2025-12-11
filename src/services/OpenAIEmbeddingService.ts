import OpenAI from 'openai';
import { getEnv } from '../config/environment.js';

export type OpenAIEmbeddingModel = 'text-embedding-3-small' | 'text-embedding-3-large' | 'text-embedding-ada-002';

export interface EmbeddingResult {
  embedding: number[];
  dimensions: number;
  model: string;
}

export class OpenAIEmbeddingService {
  private static instance: OpenAIEmbeddingService;
  private client: OpenAI;
  private model: OpenAIEmbeddingModel;
  private readonly maxBatchSize = 2048;

  private constructor() {
    const env = getEnv();
    
    if (!env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required for OpenAI embedding service');
    }

    this.client = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
    });

    this.model = env.OPENAI_EMBEDDING_MODEL as OpenAIEmbeddingModel;
  }

  public static getInstance(): OpenAIEmbeddingService {
    if (!OpenAIEmbeddingService.instance) {
      OpenAIEmbeddingService.instance = new OpenAIEmbeddingService();
    }
    return OpenAIEmbeddingService.instance;
  }

  /**
   * Generate embedding for a single text
   */
  public async generateEmbedding(text: string): Promise<EmbeddingResult> {
    try {
      const response = await this.client.embeddings.create({
        model: this.model,
        input: text,
        encoding_format: 'float',
      });

      const embeddingData = response.data[0];
      
      return {
        embedding: embeddingData.embedding,
        dimensions: embeddingData.embedding.length,
        model: this.model,
      };
    } catch (error) {
      console.error('Error generating OpenAI embedding:', error);
      throw new Error(`Failed to generate embedding: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate embeddings for multiple texts (batch processing)
   * Automatically handles batching to respect OpenAI's limits
   */
  public async generateEmbeddings(texts: string[]): Promise<EmbeddingResult[]> {
    if (texts.length === 0) {
      return [];
    }

    // If batch is within limits, process all at once
    if (texts.length <= this.maxBatchSize) {
      return this.processBatch(texts);
    }

    // Otherwise, split into chunks
    const results: EmbeddingResult[] = [];
    for (let i = 0; i < texts.length; i += this.maxBatchSize) {
      const batch = texts.slice(i, i + this.maxBatchSize);
      const batchResults = await this.processBatch(batch);
      results.push(...batchResults);
    }

    return results;
  }

  private async processBatch(texts: string[]): Promise<EmbeddingResult[]> {
    try {
      const response = await this.client.embeddings.create({
        model: this.model,
        input: texts,
        encoding_format: 'float',
      });

      return response.data.map((item) => ({
        embedding: item.embedding,
        dimensions: item.embedding.length,
        model: this.model,
      }));
    } catch (error) {
      console.error('Error generating OpenAI embeddings batch:', error);
      throw new Error(`Failed to generate embeddings: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get the dimensions for the current model
   */
  public getDimensions(): number {
    switch (this.model) {
      case 'text-embedding-3-small':
        return 1536;
      case 'text-embedding-3-large':
        return 3072;
      case 'text-embedding-ada-002':
        return 1536;
      default:
        return 1536;
    }
  }

  /**
   * Get the current model name
   */
  public getModel(): string {
    return this.model;
  }
}
