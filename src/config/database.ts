import dotenv from 'dotenv';
import { Pool } from 'pg';

// Load environment variables
dotenv.config();

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  maxConnections: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
}

export const dbConfig: DatabaseConfig = {
  host: process.env['DB_HOST'] || 'localhost',
  port: parseInt(process.env['DB_PORT'] || '5432'),
  database: process.env['DB_NAME'] || 'rag_db',
  user: process.env['DB_USER'] || 'postgres',
  password: process.env['DB_PASSWORD'] || '',
  maxConnections: parseInt(process.env['MAX_DB_CONNECTIONS'] || '10'),
  idleTimeoutMillis: parseInt(process.env['DB_IDLE_TIMEOUT'] || '30000'),
  connectionTimeoutMillis: parseInt(process.env['DB_CONNECTION_TIMEOUT'] || '2000'),
};

// Create connection pool
export const dbPool = new Pool({
  host: dbConfig.host,
  port: dbConfig.port,
  database: dbConfig.database,
  user: dbConfig.user,
  password: dbConfig.password,
  max: dbConfig.maxConnections,
  idleTimeoutMillis: dbConfig.idleTimeoutMillis,
  connectionTimeoutMillis: dbConfig.connectionTimeoutMillis,
  ssl: process.env['NODE_ENV'] === 'production' ? { rejectUnauthorized: false } : false,
});

// Database connection helper
export async function getConnection() {
  const client = await dbPool.connect();
  return client;
}

// Health check function
export async function checkDatabaseHealth() {
  try {
    const client = await getConnection();
    await client.query('SELECT 1');
    client.release();
    return { healthy: true, message: 'Database connection successful' };
  } catch (error) {
    return { healthy: false, message: `Database health check failed: ${error}` };
  }
}
