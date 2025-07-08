# Meridian Backend Worker (`@meridian/backend`)

This Cloudflare Worker application forms the core data ingestion, processing, and API layer for the Meridian project - an AI-powered personalized intelligence briefing system. It handles fetching news sources, orchestrating article content scraping, performing AI analysis, managing data persistence, and generating intelligent briefings.

The system leverages Cloudflare's edge computing ecosystem for high performance, scalability, and cost efficiency:

- **Workers:** Runs the Hono API server, queue consumer logic, Workflow triggers, and Durable Object interactions
- **Durable Objects (`SourceScraperDO`):** Manages state and scheduled fetching for individual news sources via Alarms
- **Queues (`article-processing-queue`):** Decouples lightweight source checks from intensive article processing
- **Workflows (`ProcessArticles`, `AutoBriefGenerationWorkflow`):** Provides durable, multi-step execution with automatic retries
- **R2:** Stores full article text content and observability data
- **Service Bindings:** Integrates with specialized AI Worker for complex analysis tasks

## Core Business Logic

Meridian operates as an intelligent news processing pipeline with the following key stages:

### 1. News Source Management & Scraping
- RSS sources are managed through API endpoints (`/admin/sources`)
- Each RSS source is handled by an independent Durable Object (`SourceScraperDO`)
- Periodic scraping based on configurable frequency tiers
- Efficient deduplication using `ON CONFLICT DO NOTHING`
- New articles are queued for processing

### 2. Article Content Processing
- Asynchronous processing through Cloudflare Queues
- Multi-step workflow orchestration with `ProcessArticles` Workflow
- Intelligent content extraction:
  - Standard HTTP requests for most sites
  - Browser rendering fallback for "tricky domains" (anti-bot protection, paywalls, cookie consents)
  - Mozilla Readability for clean text extraction
  - PDF detection and skipping
- Content storage in R2 with database references

### 3. AI Analysis & Insights
- **Structured Analysis:** Deep content analysis using Google Gemini or Cloudflare AI
  - Language detection, location extraction, content quality assessment
  - Event summary points, thematic keywords, topic tags
  - Key entities identification, content focus analysis
- **Vectorization:** Embedding generation via external ML service for semantic search
- **Data Quality Assessment:** Comprehensive quality evaluation throughout processing

### 4. Intelligent Briefing Generation
- **Clustering Analysis:** ML-powered article grouping by semantic similarity
- **Story Validation:** AI-driven filtering for meaningful story clusters
- **Intelligence Analysis:** Deep analysis generating insights on overview, key developments, stakeholders, impact, and outlook
- **Final Briefing:** Structured, human-readable briefings with TLDR summaries
- **Contextual Generation:** Incorporates previous briefings for continuity

### 5. Data Query & Presentation
- RESTful APIs for briefing and article data retrieval
- OpenGraph image generation for social sharing
- Comprehensive admin and observability endpoints

## Architecture Overview

### Microservices & Event-Driven Design

The system follows a microservices architecture with clear separation of concerns:

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Main Worker   │    │  AI Worker      │    │  ML Service     │
│   (Hono API)    │◄──►│  (Analysis)     │    │  (Embeddings)   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ Source Scraper  │    │   Workflows     │    │   PostgreSQL    │
│ Durable Objects │    │ (Orchestration) │    │  (Hyperdrive)   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│     Queues      │    │       R2        │    │  Observability  │
│  (Decoupling)   │    │   (Storage)     │    │    (Logging)    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Key Architectural Patterns

- **Serverless/Edge Computing:** Global distribution via Cloudflare Workers
- **Event-Driven Processing:** Queues and Workflows for asynchronous operations
- **Data Separation:** Structured data in PostgreSQL, unstructured content in R2
- **Service Isolation:** AI/ML logic in separate workers for independent scaling
- **Observability:** Comprehensive logging and monitoring throughout

## Data Layer Design

### Database Schema (Drizzle ORM)

**Sources Table (`sources`):**
- RSS feed metadata and configuration
- Scraping frequency and paywall settings
- Durable Object initialization tracking

**Articles Table (`articles`):**
- Article metadata and processing status
- AI analysis results (structured fields)
- Vector embeddings for semantic search (`pgvector`)
- R2 content references via `contentFileKey`
- Comprehensive failure tracking

**Reports Table (`reports`):**
- Generated intelligence briefings
- Generation statistics and parameters
- Model attribution and clustering metadata

### Storage Strategy

- **PostgreSQL + Hyperdrive:** High-performance structured data storage
- **R2 Object Storage:** Cost-effective storage for large text content
- **Vector Database:** Native `pgvector` support for semantic search
- **Observability Data:** Workflow execution logs and metrics in R2

## Key Components

### 1. Hono API Server (`app.ts`)
- RESTful endpoints for reports, sources, and events
- OpenGraph image generation
- Authentication via Bearer tokens
- Admin and observability interfaces

### 2. Source Scraper Durable Object (`SourceScraperDO`)
- One instance per news source (keyed by URL)
- Cloudflare Alarms for scheduled RSS fetching
- Efficient parsing with multiple RSS format support
- Batch processing with exponential backoff retries
- State persistence and corruption protection

### 3. Article Processing Queue & Workflow
- **Queue:** Decouples discovery from processing
- **Workflow:** Durable execution with automatic retries
- **Rate Limiting:** Domain-aware politeness controls
- **Fallback Strategies:** Browser rendering for difficult sites
- **Error Handling:** Comprehensive failure categorization

### 4. AI Integration Services
- **AI Worker Binding:** Structured analysis and briefing generation
- **ML Service Client:** Embedding generation and clustering
- **Quality Assessment:** Data quality evaluation throughout pipeline
- **Model Flexibility:** Support for multiple AI providers

### 5. Observability & Monitoring
- **Structured Logging:** JSON-formatted logs for analysis
- **Workflow Tracing:** End-to-end execution tracking
- **Performance Metrics:** Processing statistics and quality indicators
- **Admin Dashboard:** System health and management interfaces

## API Endpoints

### News Source Management

#### Create New Source
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/rss",
    "name": "Example News Source",
    "category": "news",
    "scrape_frequency": 2,
    "paywall": false
  }' \
  https://your-worker.workers.dev/admin/sources
```

#### Update Source
```bash
curl -X PATCH \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Updated Source Name",
    "scrape_frequency": 3,
    "category": "technology"
  }' \
  https://your-worker.workers.dev/admin/sources/123
```

#### Delete Source
```bash
curl -X DELETE \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  https://your-worker.workers.dev/admin/sources/123
```

### Briefing Management

#### Get Latest Briefing
```bash
curl -X GET \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  https://your-worker.workers.dev/reports/last-report
```

#### Generate New Briefing
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  https://your-worker.workers.dev/admin/generate-brief
```

### System Management

#### Initialize Durable Objects
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  https://your-worker.workers.dev/do/admin/initialize-dos
```

#### Manual Source Fetch
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  https://your-worker.workers.dev/do/source/123/fetch
```

#### System Overview
```bash
curl -X GET \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  https://your-worker.workers.dev/admin/overview
```

## Configuration

### Environment Variables & Secrets

**Required Variables:**
```bash
# Database
DATABASE_URL=postgresql://user:password@host:port/database

# Authentication
API_TOKEN=your-secure-api-token

# Cloudflare
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_API_TOKEN=your-api-token

# AI Services
GEMINI_API_KEY=your-gemini-api-key
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta

# ML Services
MERIDIAN_ML_SERVICE_URL=https://your-ml-service.com
MERIDIAN_ML_SERVICE_API_KEY=your-ml-api-key
```

### `wrangler.jsonc` Configuration

Key bindings required:
- **Durable Objects:** `SOURCE_SCRAPER` → `SourceScraperDO`
- **Queues:** `ARTICLE_PROCESSING_QUEUE` for producer/consumer
- **R2 Buckets:** `ARTICLES_BUCKET` for content storage
- **Workflows:** `PROCESS_ARTICLES` and `AUTO_BRIEF_GENERATION`
- **Service Bindings:** `MERIDIAN_AI_WORKER` for analysis

## Development Setup

### Prerequisites
- Node.js (v22+)
- pnpm (v9.15+)
- Docker (for PostgreSQL + pgvector)
- Wrangler CLI

### Local Development

1. **Install Dependencies:**
   ```bash
   pnpm install
   ```

2. **Database Setup:**
   ```bash
   # Start PostgreSQL with pgvector
   docker run -p 5432:5432 -e POSTGRES_PASSWORD=password pgvector/pgvector:pg16
   
   # Run migrations
   pnpm --filter @meridian/database migrate
   
   # Seed initial sources (optional)
   pnpm --filter @meridian/database seed
   ```

3. **Environment Configuration:**
   Create `.dev.vars` file with required variables

4. **Start Development Server:**
   ```bash
   pnpm --filter @meridian/backend run dev
   ```

5. **Initialize System:**
   ```bash
   curl -X POST -H "Authorization: Bearer YOUR_API_TOKEN" \
     http://localhost:8787/do/admin/initialize-dos
   ```

## Testing

### Unit Tests
```bash
pnpm --filter @meridian/backend run test
```

### Integration Testing
The system includes several testing utilities:
- **Browser Rendering Test:** `test-cloudflare.ts` for debugging scraping issues
- **API Test Hooks:** Query parameters for testing integrations (`?_test=gemini`)
- **Workflow Testing:** Local emulation with limitations

## Deployment

### Production Deployment
```bash
# Set production secrets
npx wrangler secret put DATABASE_URL
npx wrangler secret put API_TOKEN
npx wrangler secret put GEMINI_API_KEY
# ... other secrets

# Deploy to Cloudflare
npx wrangler deploy
```

### CI/CD Pipeline
Configure automated deployment through GitHub Actions or similar, ensuring:
- Environment-specific configurations
- Database migrations
- Secret management
- Health checks post-deployment

## Monitoring & Observability

### Available Endpoints
- `/admin/overview` - System health and statistics
- `/observability/workflows` - Workflow execution status
- `/observability/briefs/stats` - Briefing generation metrics
- `/observability/dashboard` - Comprehensive system dashboard
- `/observability/quality/analysis` - Data quality assessment

### Key Metrics
- Article processing success rates
- AI analysis quality scores
- Briefing generation frequency
- Source reliability metrics
- System performance indicators

## Technology Stack

### Core Libraries
- **Hono:** Web framework for API server
- **Drizzle ORM:** TypeScript ORM for database interactions
- **postgres.js:** PostgreSQL client library
- **Neverthrow:** Functional error handling
- **Zod:** Schema validation and type safety

### AI & ML
- **@ai-sdk/google:** Google Gemini integration
- **@mozilla/readability:** Article content extraction
- **linkedom:** DOM parsing for content processing
- **fast-xml-parser:** RSS feed parsing

### Cloudflare Platform
- **Workers:** Serverless compute
- **Durable Objects:** Stateful services
- **Queues:** Message queuing
- **Workflows:** Durable execution
- **R2:** Object storage
- **Hyperdrive:** Database acceleration

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Submit a pull request

## License

[Your License Here]

## Support

For issues and questions:
- GitHub Issues for bug reports
- Documentation for API reference
- Community Discord for discussions