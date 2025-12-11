import { Pool } from 'pg';
import { dbPool, getConnection } from '../config/database.js';

export interface Document {
  id: string;
  content: string;
  metadata?: Record<string, any>;
  source?: string;
  created_at?: Date;
}

export interface DocumentWithEmbedding extends Document {
  embedding: number[];
}

export interface SimilarityResult {
  id: string;
  content: string;
  metadata?: Record<string, any>;
  source?: string;
  similarity: number;
  distance: number;
}

export class DatabaseService {
  private pool: Pool;

  constructor() {
    this.pool = dbPool;
  }

  /**
   * Initialize database schema
   */
  public async initializeSchema(): Promise<void> {
    const client = await getConnection();
    
    try {
      await client.query('BEGIN');

      // Enable pgvector extension
      await client.query('CREATE EXTENSION IF NOT EXISTS vector');

      // Create schema
      await client.query('CREATE SCHEMA IF NOT EXISTS rag');

      // Create documents table
      await client.query(`
        CREATE TABLE IF NOT EXISTS rag.documents (
          id SERIAL PRIMARY KEY,
          content TEXT NOT NULL,
          metadata JSONB DEFAULT '{}',
          source_url VARCHAR(2048),
          title VARCHAR(512),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // Create embeddings table
      await client.query(`
        CREATE TABLE IF NOT EXISTS rag.embeddings (
          id SERIAL PRIMARY KEY,
          document_id INTEGER NOT NULL REFERENCES rag.documents(id) ON DELETE CASCADE,
          embedding vector(384) NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // Create indexes
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_documents_created_at 
        ON rag.documents(created_at)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_documents_source_url 
        ON rag.documents(source_url)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_documents_metadata 
        ON rag.documents USING GIN (metadata)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_embeddings_document_id 
        ON rag.embeddings(document_id)
      `);

      // Create HNSW index for vector similarity search
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_embeddings_vector 
        ON rag.embeddings USING hnsw (embedding vector_cosine_ops)
      `);

      await client.query('COMMIT');
      console.log('✓ Database schema initialized successfully');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Failed to initialize schema:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Insert a document with its embedding
   */
  public async insertDocument(
    content: string,
    embedding: number[],
    metadata?: Record<string, any>,
    source?: string,
    _model: string = 'Xenova/all-MiniLM-L6-v2'
  ): Promise<string> {
    const client = await getConnection();

    try {
      await client.query('BEGIN');

      // Insert document
      const docResult = await client.query(
        `INSERT INTO rag.documents (content, metadata, source_url, title) 
         VALUES ($1, $2, $3, $4) 
         RETURNING id`,
        [content, JSON.stringify(metadata || {}), source, metadata?.['title'] || null]
      );

      const documentId = docResult.rows[0].id;

      // Insert embedding
      await client.query(
        `INSERT INTO rag.embeddings (document_id, embedding) 
         VALUES ($1, $2)`,
        [documentId, JSON.stringify(embedding)]
      );

      await client.query('COMMIT');
      return documentId;
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Failed to insert document:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Batch insert documents with embeddings
   */
  public async batchInsertDocuments(
    documents: Array<{
      content: string;
      embedding: number[];
      metadata?: Record<string, any>;
      source?: string;
    }>,
    _model: string = 'Xenova/all-MiniLM-L6-v2'
  ): Promise<string[]> {
    const client = await getConnection();
    const documentIds: string[] = [];

    try {
      await client.query('BEGIN');

      for (const doc of documents) {
        const docResult = await client.query(
          `INSERT INTO rag.documents (content, metadata, source_url, title) 
           VALUES ($1, $2, $3, $4) 
           RETURNING id`,
          [doc.content, JSON.stringify(doc.metadata || {}), doc.source, doc.metadata?.['title'] || null]
        );

        const documentId = docResult.rows[0].id;
        documentIds.push(documentId);

        await client.query(
          `INSERT INTO rag.embeddings (document_id, embedding) 
           VALUES ($1, $2)`,
          [documentId, JSON.stringify(doc.embedding)]
        );
      }

      await client.query('COMMIT');
      console.log(`✓ Inserted ${documentIds.length} documents successfully`);
      return documentIds;
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Failed to batch insert documents:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Search for similar documents using vector similarity
   */
  public async searchSimilar(
    queryEmbedding: number[],
    limit: number = 5,
    threshold: number = 0.7
  ): Promise<SimilarityResult[]> {
    const client = await getConnection();

    try {
      const result = await client.query(
        `SELECT 
          d.id,
          d.content,
          d.metadata,
          d.source_url as source,
          1 - (e.embedding <=> $1::vector) AS similarity,
          e.embedding <=> $1::vector AS distance
        FROM rag.documents d
        JOIN rag.embeddings e ON d.id = e.document_id
        WHERE 1 - (e.embedding <=> $1::vector) >= $2
        ORDER BY e.embedding <=> $1::vector
        LIMIT $3`,
        [JSON.stringify(queryEmbedding), threshold, limit]
      );

      return result.rows.map(row => ({
        id: row.id,
        content: row.content,
        metadata: row.metadata,
        source: row.source,
        similarity: parseFloat(row.similarity),
        distance: parseFloat(row.distance),
      }));
    } finally {
      client.release();
    }
  }

  /**
   * Get document by ID
   */
  public async getDocumentById(id: string): Promise<Document | null> {
    const client = await getConnection();

    try {
      const result = await client.query(
        `SELECT id, content, metadata, source_url as source, created_at 
         FROM rag.documents 
         WHERE id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return result.rows[0];
    } finally {
      client.release();
    }
  }

  /**
   * Delete document by ID
   */
  public async deleteDocument(id: string): Promise<boolean> {
    const client = await getConnection();

    try {
      const result = await client.query(
        `DELETE FROM rag.documents WHERE id = $1`,
        [id]
      );

      return result.rowCount !== null && result.rowCount > 0;
    } finally {
      client.release();
    }
  }

  /**
   * Get total document count
   */
  public async getDocumentCount(): Promise<number> {
    const client = await getConnection();

    try {
      const result = await client.query(`SELECT COUNT(*) FROM rag.documents`);
      return parseInt(result.rows[0].count);
    } finally {
      client.release();
    }
  }

  /**
   * Close database connections
   */
  public async close(): Promise<void> {
    await this.pool.end();
    console.log('Database connections closed');
  }
}

// Export singleton instance
export const databaseService = new DatabaseService();
