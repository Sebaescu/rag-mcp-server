import { createClient, RedisClientType } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

export class RedisCacheService {
  private static instance: RedisCacheService;
  private client: RedisClientType | null = null;
  private isConnected: boolean = false;
  private db: number;

  private constructor() {
    this.db = parseInt(process.env['REDIS_DB'] || '1');
  }

  public static getInstance(): RedisCacheService {
    if (!RedisCacheService.instance) {
      RedisCacheService.instance = new RedisCacheService();
    }
    return RedisCacheService.instance;
  }

  public async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    try {
      this.client = createClient({
        socket: {
          host: process.env['REDIS_HOST'] || 'localhost',
          port: parseInt(process.env['REDIS_PORT'] || '6379'),
        },
        password: process.env['REDIS_PASSWORD'] || undefined,
        database: this.db,
      });

      this.client.on('error', (err) => console.error('Redis Client Error:', err));
      
      await this.client.connect();
      this.isConnected = true;
      console.log(`✓ Connected to Redis database ${this.db}`);
    } catch (error) {
      console.error('Failed to connect to Redis:', error);
      this.isConnected = false;
    }
  }

  public async get(key: string): Promise<any | null> {
    if (!this.isConnected || !this.client) {
      return null;
    }

    try {
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error('Redis GET error:', error);
      return null;
    }
  }

  public async set(key: string, value: any, ttl?: number): Promise<void> {
    if (!this.isConnected || !this.client) {
      return;
    }

    try {
      const serialized = JSON.stringify(value);
      const cacheTTL = ttl || parseInt(process.env['REDIS_CACHE_TTL'] || '3600');
      
      await this.client.setEx(key, cacheTTL, serialized);
    } catch (error) {
      console.error('Redis SET error:', error);
    }
  }

  public async delete(key: string): Promise<void> {
    if (!this.isConnected || !this.client) {
      return;
    }

    try {
      await this.client.del(key);
    } catch (error) {
      console.error('Redis DELETE error:', error);
    }
  }

  public async exists(key: string): Promise<boolean> {
    if (!this.isConnected || !this.client) {
      return false;
    }

    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      console.error('Redis EXISTS error:', error);
      return false;
    }
  }

  public generateKey(prefix: string, ...parts: string[]): string {
    return `rag:${prefix}:${parts.join(':')}`;
  }

  public async disconnect(): Promise<void> {
    if (this.client && this.isConnected) {
      await this.client.quit();
      this.isConnected = false;
      console.log('Redis disconnected');
    }
  }
}

export const redisCache = RedisCacheService.getInstance();
