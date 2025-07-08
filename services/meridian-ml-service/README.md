# Meridian ML Service

An AI-driven intelligent clustering and embedding generation service designed for the Meridian project, providing core machine learning capabilities with efficient text embedding, robust clustering with parameter optimization, and seamless integration with existing backend systems.

## 🌟 Key Features

- **Multi-language Embedding Generation**: Uses `intfloat/multilingual-e5-small` model for high-quality text embeddings
- **Intelligent Clustering**: UMAP dimensionality reduction + HDBSCAN clustering algorithms with automatic parameter optimization
- **AI Worker Integration**: Perfect compatibility with Meridian backend data formats
- **Production Ready**: Docker containerized with health checks and monitoring support
- **Flexible API**: Auto-detects input data formats and provides multiple endpoint options
- **Scalable Architecture**: Modular pipeline design supporting various deployment methods

## 🚀 Quick Start

### Local Development

1. **Install Dependencies**:
```bash
cd services/meridian-ml-service
pip install -e .
```

2. **Start Service**:
```bash
./start_local.sh
```

3. **Test Service**:
```bash
curl http://localhost:8081/health
```

### Docker Deployment

#### Method 1: Using docker-compose (Recommended)

```bash
# Development environment
docker-compose up -d

# Production environment (without source code mounting)
docker-compose --profile production up -d
```

#### Method 2: Direct Docker Run

```bash
# Build image
docker build -t meridian-ml-service:latest .

# Run container
docker run -d \
  --name meridian-ml-service \
  -p 8081:8080 \
  -e API_TOKEN=your-secure-token \
  -e EMBEDDING_MODEL_NAME=intfloat/multilingual-e5-small \
  meridian-ml-service:latest
```

## 🏗️ System Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Meridian      │    │   ML Service    │    │   Models        │
│   Backend       │────│   FastAPI       │────│   E5-Small      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                              │
                       ┌─────────────────┐
                       │   Clustering    │
                       │   UMAP+HDBSCAN  │
                       └─────────────────┘
```

### Core Components

The system is structured into several logical components:

- **Core ML Service**: FastAPI application exposing ML functionalities via RESTful APIs
- **ML Pipeline**: Modular processing pipeline with data extraction, clustering, and content analysis stages
- **Embedding Engine**: Handles loading and computation of text embeddings using transformer models
- **Clustering Engine**: Implements UMAP + HDBSCAN with automatic parameter optimization
- **AI Worker Integration**: Seamless compatibility with existing AI Worker data formats

### Technology Stack

- **Web Framework**: FastAPI + Uvicorn
- **AI Models**: Transformers + PyTorch (CPU)
- **Clustering**: UMAP + HDBSCAN + Scikit-learn
- **Data Validation**: Pydantic v2
- **Containerization**: Docker + Docker Compose
- **Reverse Proxy**: Nginx (production)
- **Monitoring**: Prometheus + Grafana (optional)

## 🛠️ Build and Deployment

### 1. Local Build

```bash
# Build image only
./build-and-push-multiarch.sh --build-only

# Build and push to Docker Hub
./build-and-push-multiarch.sh --push --user your-dockerhub-username

# Multi-architecture build
./build-and-push-multiarch.sh --platform linux/amd64,linux/arm64 --push
```

### 2. VPS Deployment

#### Simple Deployment
```bash
# Deploy to VPS (auto-generate API token)
./deploy-to-vps.sh --host user@your-vps-ip

# Use custom image and token
./deploy-to-vps.sh --host user@your-vps-ip \
  --image your-dockerhub-user/meridian-ml-service \
  --token your-api-token
```

#### Production Deployment (with SSL and Monitoring)
```bash
# Complete production environment deployment
./deploy-to-vps.sh --host user@your-vps-ip \
  --domain api.yourdomain.com \
  --monitoring
```

This automatically configures:
- ✅ SSL certificates (Let's Encrypt)
- ✅ Nginx reverse proxy
- ✅ Prometheus monitoring
- ✅ Grafana dashboard
- ✅ Auto-restart and health checks

## 📋 Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `API_TOKEN` | API access token | Required |
| `EMBEDDING_MODEL_NAME` | Embedding model name | `intfloat/multilingual-e5-small` |
| `LOG_LEVEL` | Logging level | `INFO` |
| `BATCH_SIZE` | Processing batch size | `32` |
| `MAX_TEXT_LENGTH` | Maximum text length | `512` |
| `PYTHONUNBUFFERED` | Python output buffering | `1` |

## 🔧 API Endpoints

### Core Endpoints

- `GET /` - Service information and available endpoints
- `GET /health` - Health check with ML functionality status
- `GET /metrics` - System metrics and supported data formats
- `GET /config` - Current configuration settings
- `POST /embeddings` - Generate text embeddings
- `POST /ai-worker/clustering` - AI Worker format clustering
- `POST /clustering/auto` - Auto-detect format clustering

### API Request Examples

#### Embedding Generation
```bash
curl -X POST "http://localhost:8081/embeddings" \
  -H "X-API-Token: your-api-token" \
  -H "Content-Type: application/json" \
  -d '{
    "texts": ["Hello world", "Machine learning is fascinating"],
    "normalize": true
  }'
```

#### AI Worker Clustering
```bash
curl -X POST "http://localhost:8081/ai-worker/clustering" \
  -H "X-API-Token: your-api-token" \
  -H "Content-Type: application/json" \
  -d '[
    {
      "id": 1,
      "embedding": [0.1, 0.2, ..., 0.384],
      "title": "Article Title",
      "url": "https://example.com/article1"
    },
    {
      "id": 2,
      "embedding": [0.3, 0.4, ..., 0.256],
      "title": "Another Article",
      "url": "https://example.com/article2"
    }
  ]'
```

#### Auto-Format Clustering
```bash
curl -X POST "http://localhost:8081/clustering/auto" \
  -H "X-API-Token: your-api-token" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {"text": "First document to cluster"},
      {"text": "Second document with similar content"},
      {"text": "Third document about different topic"}
    ],
    "config": {
      "min_cluster_size": 2,
      "min_samples": 1
    },
    "optimization": {
      "enabled": true,
      "metric": "dbcv"
    },
    "content_analysis": {
      "enabled": true,
      "max_representative_content": 3
    }
  }'
```

## 🔍 Data Flow and Processing Pipeline

The service processes data through a modular pipeline:

1. **Request Reception**: Client sends HTTP POST request with JSON payload
2. **Authentication**: Verifies `X-API-Token` header for authorized access
3. **Input Validation**: Validates JSON using Pydantic models with auto-format detection
4. **Data Extraction Stage**:
   - Generates embeddings for raw text using transformer models
   - Extracts and validates pre-computed embeddings
   - Preserves original texts and metadata
5. **Clustering Stage**:
   - Applies UMAP for dimensionality reduction
   - Performs HDBSCAN clustering with density-based grouping
   - Optimizes parameters using DBCV metric (if enabled)
6. **Content Analysis Stage**:
   - Combines clustering results with original content
   - Identifies representative content for each cluster
   - Compiles statistical summaries
7. **Response Generation**: Returns structured results following API schema

## 📊 Supported Data Formats

The service automatically detects and processes multiple input formats:

### Text Format
```json
{
  "items": [
    {"text": "Document content to cluster"},
    {"text": "Another document for analysis"}
  ]
}
```

### Vector Format
```json
{
  "items": [
    {"embedding": [0.1, 0.2, ..., 0.384]},
    {"embedding": [0.3, 0.4, ..., 0.256]}
  ]
}
```

### AI Worker Basic Format
```json
[
  {
    "id": 1,
    "embedding": [0.1, 0.2, ..., 0.384]
  },
  {
    "id": 2,
    "embedding": [0.3, 0.4, ..., 0.256]
  }
]
```

### AI Worker Extended Format
```json
[
  {
    "id": 1,
    "embedding": [0.1, 0.2, ..., 0.384],
    "title": "Article Title",
    "url": "https://example.com/article1"
  }
]
```

### AI Worker Full Article Format
```json
[
  {
    "id": 1,
    "embedding": [0.1, 0.2, ..., 0.384],
    "title": "Complete Article Title",
    "url": "https://example.com/article1",
    "content": "Full article content...",
    "author": "Author Name",
    "published_date": "2024-01-01",
    "source": "Source Name"
  }
]
```

## 🎛️ Configuration Options

### Clustering Configuration
```json
{
  "config": {
    "min_cluster_size": 5,
    "min_samples": 3,
    "n_neighbors": 15,
    "n_components": 10,
    "metric": "cosine"
  }
}
```

### Optimization Configuration
```json
{
  "optimization": {
    "enabled": true,
    "metric": "dbcv",
    "n_trials": 20,
    "umap_params": {
      "n_neighbors": [5, 10, 15],
      "n_components": [5, 10, 15],
      "min_dist": [0.0, 0.1, 0.25]
    },
    "hdbscan_params": {
      "min_cluster_size": [3, 5, 10],
      "min_samples": [1, 3, 5]
    }
  }
}
```

### Content Analysis Configuration
```json
{
  "content_analysis": {
    "enabled": true,
    "max_representative_content": 5,
    "include_outliers": true
  }
}
```

## 📈 Monitoring and Operations

### Health Monitoring

```bash
# Local health check
curl http://localhost:8081/health

# VPS health check
curl http://your-vps-ip:8080/health
```

### View Logs

```bash
# Docker Compose
docker-compose logs -f ml-service

# Single container
docker logs meridian-ml-service -f
```

### Performance Monitoring

If monitoring is enabled:
- **Grafana**: `http://your-vps-ip:3000` (admin/admin123)
- **Prometheus**: `http://your-vps-ip:9090`

## 🛡️ Security Configuration

### Production Security Checklist

- [ ] Set strong API token password
- [ ] Configure SSL certificates (HTTPS)
- [ ] Enable firewall rules
- [ ] Regular dependency updates
- [ ] Configure log rotation
- [ ] Set resource limits

### Recommended Security Setup

```bash
# Generate secure API token
openssl rand -hex 32

# Configure firewall (Ubuntu/Debian)
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable
```

## 🚨 Troubleshooting

### Common Issues

1. **Image Build Failures**
   ```bash
   # Check Docker version
   docker --version
   
   # Clean cache and rebuild
   docker system prune -a
   ./build-and-push-multiarch.sh --build-only
   ```

2. **Health Check Failures**
   ```bash
   # Check container logs
   docker logs meridian-ml-service --tail 50
   
   # Check port usage
   netstat -tulpn | grep :8080
   ```

3. **VPS Deployment Issues**
   ```bash
   # Test SSH connection
   ssh user@your-vps-ip "docker --version"
   
   # Manual deployment
   scp docker-compose.yml user@your-vps-ip:~/
   ssh user@your-vps-ip "cd ~ && docker-compose up -d"
   ```

### Performance Optimization

- **Memory**: Minimum 2GB RAM recommended
- **CPU**: At least 1 core, 2+ cores recommended
- **Storage**: Minimum 10GB available space
- **Network**: Stable internet connection (for model downloads)

## 🧪 Testing

### Running Tests

```bash
# Install development dependencies
pip install -e ".[dev]"

# Run all tests
pytest

# Run specific test modules
pytest test/test_ml_service.py
pytest test/test_ai_worker_integration.py
pytest test/test_small_dataset.py
```

### Test Coverage

The test suite includes:
- **Unit Tests**: Individual component testing
- **Integration Tests**: AI Worker format compatibility
- **Edge Case Tests**: Small dataset handling
- **Mock Data Tests**: Synthetic data validation

## 📚 API Documentation

Access comprehensive API documentation after deployment:

- **Swagger UI**: `http://your-host:8080/docs`
- **ReDoc**: `http://your-host:8080/redoc`

## 🤝 Development

### Development Environment Setup

```bash
# Clone repository
git clone <repository-url>
cd meridian/services/meridian-ml-service

# Install development dependencies
pip install -e ".[dev]"

# Code formatting
ruff format .
ruff check .

# Type checking
mypy src/
```

### Project Structure

```
src/meridian_ml_service/
├── main.py              # FastAPI application entry point
├── config.py            # Configuration management
├── schemas.py           # Pydantic data models
├── dependencies.py      # FastAPI dependency injection
├── embeddings.py        # Embedding generation
├── clustering.py        # Clustering algorithms
└── pipeline.py          # ML processing pipeline

docs/
├── PROJECT_SUMMARY.md   # Project overview
├── DOCKER_GUIDE.md      # Docker deployment guide
├── AI_WORKER_INTEGRATION.md  # AI Worker compatibility
└── README-DEPLOYMENT.md # Deployment instructions

scripts/
├── build-and-push.sh    # Docker build automation
├── deploy-vps.sh        # VPS deployment
├── download_model.py    # Model pre-download
└── test_service.py      # Service testing

test/
├── test_ml_service.py   # Main service tests
├── test_ai_worker_integration.py  # AI Worker tests
├── test_small_dataset.py  # Edge case tests
└── generate_mock_articles.py  # Mock data generation
```

### Module Architecture

- **`main.py`**: FastAPI application with endpoint definitions and request orchestration
- **`config.py`**: Environment-based configuration using Pydantic Settings
- **`schemas.py`**: Request/response models and data format detection utilities
- **`dependencies.py`**: Shared resources and authentication management
- **`embeddings.py`**: Transformer model loading and text-to-vector conversion
- **`clustering.py`**: UMAP + HDBSCAN implementation with parameter optimization
- **`pipeline.py`**: Modular processing workflow with configurable stages

## 🔗 Integration Points

### Meridian Backend Integration

The service is designed as a drop-in replacement for existing AI Worker services:

- **Compatible Data Formats**: Supports all AI Worker data structures
- **Consistent API**: Maintains familiar endpoint patterns
- **Enhanced Features**: Adds parameter optimization and content analysis
- **Migration Support**: Provides automated format detection and conversion

### External Dependencies

- **Hugging Face Hub**: Downloads `intfloat/multilingual-e5-small` model
- **Docker Hub**: Hosts pre-built images (`crossovo/meridian-ml-service`)
- **Nginx**: Production reverse proxy configuration
- **Prometheus/Grafana**: Optional monitoring and visualization

## 📄 License

This project is licensed under the MIT License. See [LICENSE](../../LICENSE) file for details.

## 🆘 Getting Help

- **Documentation**: Check the `docs/` directory
- **Issues**: Submit issues on GitHub Issues
- **Discussions**: Join GitHub Discussions
- **API Reference**: Visit `/docs` endpoint after deployment

---

**Meridian ML Service** - Making AI-powered clustering simple and efficient 🚀