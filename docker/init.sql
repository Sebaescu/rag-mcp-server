-- Initialize PostgreSQL with pgvector extension and RAG schema
-- This script runs automatically when the container is first created

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create RAG schema
CREATE SCHEMA IF NOT EXISTS rag;

-- Create documents table
CREATE TABLE IF NOT EXISTS rag.documents (
    id SERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    source_url VARCHAR(2048),
    title VARCHAR(512),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create embeddings table
CREATE TABLE IF NOT EXISTS rag.embeddings (
    id SERIAL PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES rag.documents(id) ON DELETE CASCADE,
    embedding vector(384) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance

-- HNSW index for vector similarity search (fast approximate search)
CREATE INDEX IF NOT EXISTS embeddings_embedding_idx 
ON rag.embeddings 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- GIN index for metadata JSONB queries
CREATE INDEX IF NOT EXISTS documents_metadata_idx 
ON rag.documents 
USING gin (metadata);

-- B-tree indexes for common queries
CREATE INDEX IF NOT EXISTS documents_source_url_idx 
ON rag.documents (source_url);

CREATE INDEX IF NOT EXISTS documents_created_at_idx 
ON rag.documents (created_at DESC);

CREATE INDEX IF NOT EXISTS embeddings_document_id_idx 
ON rag.embeddings (document_id);

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION rag.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers to update updated_at
CREATE TRIGGER update_documents_updated_at
    BEFORE UPDATE ON rag.documents
    FOR EACH ROW
    EXECUTE FUNCTION rag.update_updated_at_column();

CREATE TRIGGER update_embeddings_updated_at
    BEFORE UPDATE ON rag.embeddings
    FOR EACH ROW
    EXECUTE FUNCTION rag.update_updated_at_column();

-- Grant permissions (optional, for additional security)
-- GRANT ALL PRIVILEGES ON SCHEMA rag TO rag_user;
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA rag TO rag_user;
-- GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA rag TO rag_user;

-- Create view for easy querying of documents with embeddings
CREATE OR REPLACE VIEW rag.documents_with_embeddings AS
SELECT 
    d.id,
    d.content,
    d.metadata,
    d.source_url,
    d.title,
    d.created_at,
    d.updated_at,
    e.embedding,
    e.id as embedding_id
FROM rag.documents d
LEFT JOIN rag.embeddings e ON d.id = e.document_id;

-- Insert a test document to verify setup
INSERT INTO rag.documents (content, metadata, title)
VALUES (
    'This is a test document to verify the RAG system setup.',
    '{"tags": ["test", "setup"], "version": "1.0"}'::jsonb,
    'Test Document'
) ON CONFLICT DO NOTHING;

-- Log completion
DO $$
BEGIN
    RAISE NOTICE 'RAG database schema initialized successfully';
END $$;
