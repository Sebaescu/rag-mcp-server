# Deployment Guide

This guide covers deploying the RAG MCP Server to production environments.

## Table of Contents

- [Docker Deployment](#docker-deployment)
- [Environment Configuration](#environment-configuration)
- [Health Checks & Monitoring](#health-checks--monitoring)
- [Scaling](#scaling)
- [Backup & Recovery](#backup--recovery)
- [Security](#security)
- [Troubleshooting](#troubleshooting)

## Docker Deployment

### Prerequisites

- Docker 20.10+
- Docker Compose 2.0+
- At least 2GB RAM
- 10GB disk space (for models and data)

### Production Deployment

1. **Clone the repository**:

    ```bash
    git clone <your-repo-url>
    cd rag-mcp-server
    ```

2. **Create production environment file**:

    ```bash
    cp .env.example .env
    ```

3. **Configure production settings**:

    ```env
    # Database (use strong passwords!)
    DB_PASSWORD=<strong-random-password>

    # Embedding provider
    EMBEDDING_PROVIDER=openai  # or 'local' for self-hosted
    OPENAI_API_KEY=sk-...      # if using OpenAI

    # Security
    REDIS_PASSWORD=<redis-password>

    # Environment
    NODE_ENV=production
    LOG_LEVEL=warn
    ```

4. **Start services**:

    ```bash
    docker-compose up -d
    ```

5. **Verify deployment**:

    ```bash
    # Check all services are running
    docker-compose ps

    # Check health
    curl http://localhost:3000/health

    # View logs
    docker-compose logs -f rag-server
    ```

### Update Deployment

```bash
# Pull latest changes
git pull

# Rebuild and restart
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

## Environment Configuration

### Critical Settings

#### Database Configuration

```env
DB_HOST=postgres          # Use service name in Docker
DB_PORT=5432
DB_NAME=rag_db
DB_USER=rag_user
DB_PASSWORD=<strong-password>  # MUST be secure in production
```

**Security Notes**:

- Use a strong, randomly generated password (20+ characters)
- Never commit `.env` to version control
- Rotate passwords regularly

#### Redis Configuration

```env
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_DB=1
REDIS_PASSWORD=<optional-password>  # Recommended for production
```

#### Embedding Provider

#### Option 1: Local (Free, Private)

```env
EMBEDDING_PROVIDER=local
```

- No external dependencies
- ~1-2 seconds per document
- 384-dimensional vectors
- Model auto-downloads (~100MB)

#### Option 2: OpenAI (Best Quality)

```env
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=sk-proj-...
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

- Costs: ~$0.0001 per 1K tokens
- Fast batch processing
- 1536 or 3072 dimensions
- Requires internet connection

### Server Configuration

```env
PORT=3000              # HTTP health check port
NODE_ENV=production    # production, development, or test
LOG_LEVEL=info         # error, warn, info, debug
CACHE_TTL=3600         # Cache time-to-live in seconds
```

## Health Checks & Monitoring

### Built-in Endpoints

#### Health Check

```bash
curl http://localhost:3000/health
```

**Response**:

```json
{
  "status": "healthy",
  "uptime": 86400,
  "database": "connected",
  "timestamp": "2024-01-15T12:00:00.000Z"
}
```

**Status Codes**:

- `200`: All systems operational
- `503`: Service unavailable (database down, etc.)

#### Metrics

```bash
curl http://localhost:3000/metrics
```

**Response**:

```json
{
  "requestCount": 5432,
  "errorCount": 12,
  "uptime": 86400,
  "errorRate": "0.22%"
}
```

### Docker Health Checks

Docker automatically monitors container health:

```bash
# Check container health status
docker ps

# View health check logs
docker inspect rag-mcp-server | grep -A 10 Health
```

### Monitoring Best Practices

1. **Set up external monitoring**:

    - Use tools like Uptime Robot, Pingdom, or custom scripts
    - Monitor `/health` endpoint every 60 seconds
    - Alert on 3+ consecutive failures

2. **Log aggregation**:

    - Collect logs from all containers
    - Use ELK stack, Grafana Loki, or cloud logging
    - Set up alerts for ERROR level logs

3. **Metrics tracking**:

    - Track request count, error rate, response time
    - Monitor database size growth
    - Track embedding API usage (if using OpenAI)

## Scaling

### Horizontal Scaling

The RAG server can be scaled horizontally:

```yaml
# docker-compose.yml
services:
  rag-server:
    # ... existing config
    deploy:
      replicas: 3
```

**Notes**:

- PostgreSQL and Redis are shared across instances
- Use a load balancer (nginx, HAProxy)
- Embedding model cache is per-instance

### Vertical Scaling

Allocate more resources:

```yaml
services:
  rag-server:
    # ... existing config
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 4G
        reservations:
          cpus: '1'
          memory: 2G
```

### Database Scaling

For large datasets (1M+ documents):

1. **Enable connection pooling**:

    - Increase `max_connections` in PostgreSQL
    - Use PgBouncer for connection pooling

2. **Optimize indexes**:

    ```sql
    -- Tune HNSW index for your workload
    DROP INDEX IF EXISTS rag.embeddings_embedding_idx;
    CREATE INDEX embeddings_embedding_idx 
    ON rag.embeddings 
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 32, ef_construction = 128);  -- Higher values = better recall, slower build
    ```

3. **Partition tables** (for 10M+ documents):

    ```sql
    -- Partition by creation date
    CREATE TABLE rag.documents_partitioned (
      LIKE rag.documents INCLUDING ALL
    ) PARTITION BY RANGE (created_at);
    ```

## Backup & Recovery

### Database Backup

**Automated daily backups**:

```bash
# Create backup script
cat > backup.sh << 'EOF'
#!/bin/bash
BACKUP_DIR=/backups
DATE=$(date +%Y%m%d_%H%M%S)

docker-compose exec -T postgres pg_dump -U rag_user rag_db > \
  $BACKUP_DIR/rag_db_$DATE.sql

# Keep only last 7 days
find $BACKUP_DIR -name "rag_db_*.sql" -mtime +7 -delete
EOF

chmod +x backup.sh

# Add to crontab (daily at 2 AM)
crontab -e
# Add: 0 2 * * * /path/to/backup.sh
```

**Restore from backup**:

```bash
docker-compose exec -T postgres psql -U rag_user -d rag_db < backup_file.sql
```

### Volume Backup

```bash
# Backup PostgreSQL data volume
docker run --rm \
  -v rag-mcp-server_postgres_data:/data \
  -v $(pwd)/backups:/backup \
  alpine tar czf /backup/postgres_data.tar.gz -C /data .

# Backup Redis data
docker run --rm \
  -v rag-mcp-server_redis_data:/data \
  -v $(pwd)/backups:/backup \
  alpine tar czf /backup/redis_data.tar.gz -C /data .
```

## Security

### Best Practices

1. **Network Security**:

    - Use Docker networks (already configured)
    - Don't expose PostgreSQL/Redis ports externally in production
    - Use firewall rules (ufw, iptables)

2. **Secrets Management**:

    - Never commit `.env` file
    - Use Docker secrets or environment variable injection
    - Rotate credentials regularly

3. **Database Security**:

    - Use strong passwords (20+ characters)
    - Enable SSL for PostgreSQL connections
    - Restrict database user permissions

4. **API Security**:

    - Implement rate limiting
    - Add authentication to MCP endpoints (custom wrapper)
    - Monitor for unusual activity

### SSL/TLS Configuration

To enable SSL for PostgreSQL:

1. **Generate certificates**:

    ```bash
    openssl req -new -x509 -days 365 -nodes -text \
      -out server.crt -keyout server.key
    chmod 600 server.key
    ```

2. **Update docker-compose.yml**:

    ```yaml
    postgres:
      command: >
        -c ssl=on
        -c ssl_cert_file=/var/lib/postgresql/server.crt
        -c ssl_key_file=/var/lib/postgresql/server.key
      volumes:
        - ./server.crt:/var/lib/postgresql/server.crt
        - ./server.key:/var/lib/postgresql/server.key
    ```

3. **Update connection string**:

    ```env
    DB_SSL=true
    ```

## Troubleshooting

### Common Issues

#### Container Won't Start

```bash
# Check logs
docker-compose logs rag-server

# Check resource usage
docker stats

# Restart services
docker-compose restart
```

#### Database Connection Errors

```bash
# Verify PostgreSQL is running
docker-compose ps postgres

# Test connection
docker-compose exec postgres psql -U rag_user -d rag_db -c "SELECT 1;"

# Check network
docker-compose exec rag-server ping postgres
```

#### Out of Memory

```bash
# Check memory usage
docker stats

# Increase container limits in docker-compose.yml
# Or reduce batch sizes in code
```

#### Slow Queries

```bash
# Enable query logging
docker-compose exec postgres psql -U rag_user -d rag_db
# > SET log_min_duration_statement = 1000;  -- Log queries > 1s

# Analyze slow queries
# > EXPLAIN ANALYZE SELECT ...
```

### Logs Location

```bash
# Application logs
docker-compose logs rag-server

# PostgreSQL logs
docker-compose logs postgres

# Follow logs in real-time
docker-compose logs -f
```

### Performance Tuning

1. **Adjust PostgreSQL settings**:

    ```sql
    -- Increase shared buffers (25% of RAM)
    ALTER SYSTEM SET shared_buffers = '1GB';

    -- Increase work_mem for sorting
    ALTER SYSTEM SET work_mem = '64MB';

    -- Tune HNSW parameters
    ALTER SYSTEM SET hnsw.ef_search = 100;  -- Higher = better recall, slower
    ```

2. **Optimize Redis**:

    ```bash
    # Increase max memory
    docker-compose exec redis redis-cli CONFIG SET maxmemory 2gb
    docker-compose exec redis redis-cli CONFIG SET maxmemory-policy allkeys-lru
    ```

3. **Application tuning**:

    ```env
    # Increase cache TTL
    CACHE_TTL=7200

    # Reduce batch size if memory constrained
    MAX_BATCH_SIZE=50
    ```

## Support

For issues and questions:

- Check the [README](../README.md)
- Open an issue on GitHub
- Review logs with `docker-compose logs`

---

Last updated: December 2024
