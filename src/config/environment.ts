import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const EmbeddingProviderSchema = z.enum(['local', 'openai']);

const EnvironmentSchema = z.object({
  // Database Configuration
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.string().transform(Number).pipe(z.number().int().positive()).default('5432'),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),

  // Redis Configuration
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.string().transform(Number).pipe(z.number().int().positive()).default('6379'),
  REDIS_DB: z.string().transform(Number).pipe(z.number().int().min(0)).default('1'),
  REDIS_PASSWORD: z.string().optional(),

  // Embedding Provider Configuration
  EMBEDDING_PROVIDER: EmbeddingProviderSchema.default('local'),

  // OpenAI Configuration (required only if EMBEDDING_PROVIDER=openai)
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),

  // Server Configuration
  PORT: z.string().transform(Number).pipe(z.number().int().positive()).default('3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),

  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),

  // Cache Configuration
  CACHE_TTL: z.string().transform(Number).pipe(z.number().int().positive()).default('3600'),

  // Firecrawl Configuration (optional)
  FIRECRAWL_API_KEY: z.string().optional(),
});

export type Environment = z.infer<typeof EnvironmentSchema>;

let validatedEnv: Environment | null = null;

export function validateEnvironment(): Environment {
  if (validatedEnv) {
    return validatedEnv;
  }

  try {
    const parsed = EnvironmentSchema.parse(process.env);

    // Additional validation: if EMBEDDING_PROVIDER is 'openai', OPENAI_API_KEY is required
    if (parsed.EMBEDDING_PROVIDER === 'openai' && !parsed.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required when EMBEDDING_PROVIDER is set to "openai"');
    }

    validatedEnv = parsed;
    return parsed;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessage = error.errors
        .map((err) => `${err.path.join('.')}: ${err.message}`)
        .join('\n');
      throw new Error(`Environment validation failed:\n${errorMessage}`);
    }
    throw error;
  }
}

export function getEnv(): Environment {
  if (!validatedEnv) {
    return validateEnvironment();
  }
  return validatedEnv;
}

// Export type for embedding provider
export type EmbeddingProvider = z.infer<typeof EmbeddingProviderSchema>;
