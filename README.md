# Meridian: Your Personal Intelligence Agency

[![Build Status](https://img.shields.io/github/actions/workflow/status/iliane5/meridian/deploy-services.yaml?branch=main)](https://github.com/iliane5/meridian/actions/workflows/deploy-services.yaml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Presidential-level intelligence briefings, built with AI, tailored for you.**

Meridian is a sophisticated AI-powered intelligence briefing system that transforms the overwhelming flow of global news into concise, personalized daily intelligence reports. By leveraging advanced machine learning, natural language processing, and Cloudflare's edge computing platform, Meridian delivers the kind of analytical intelligence traditionally reserved for high-level government officials.

<p align="center">
  <img src="./screenshot.png" alt="Meridian Brief Example" width="700"/>
</p>

## 🌟 Why Meridian Exists

In an era of information overload, decision-makers need clarity, not more noise. Meridian addresses this by:

- **Cutting Through Noise**: Filters hundreds of sources to surface truly important developments
- **Providing Context**: Goes beyond headlines to analyze underlying drivers and implications
- **Delivering Intelligence**: Structured analysis with executive summaries, stakeholder mapping, and forward-looking assessments
- **Ensuring Transparency**: Open-source approach with full visibility into analysis methodology

Built for executives, researchers, analysts, and curious minds who need strategic intelligence without the time investment.

## 🏗️ System Architecture

Meridian employs a sophisticated microservices architecture built on Cloudflare's edge computing platform, where the Backend orchestrates independent AI and ML services:

```
┌─────────────────┐                    ┌─────────────────┐
│   Frontend      │◄──────────────────►│   Backend       │
│   (Nuxt 3)      │   Admin APIs &     │   (Hono API)    │
│                 │   Brief Display    │                 │
└─────────────────┘                    └─────────────────┘
         │                                       │
         ▼                                       │
┌─────────────────┐                             │
│ Cloudflare      │                             ▼
│ Pages           │              ┌─────────────────────────────────┐
└─────────────────┘              │    Workflow Orchestration       │
                                 │  ┌─────────────────────────────┐ │
                                 │  │ 1. Source Scraping          │ │
                                 │  │ 2. Article Processing       │ │
                                 │  │ 3. Brief Generation         │ │
                                 │  └─────────────────────────────┘ │
                                 └─────────────────────────────────┘
                                              │
                     ┌────────────────────────┼────────────────────────┐
                     ▼                        ▼                        ▼
          ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
          │   AI Worker     │    │   ML Service    │    │Source Scraper DO│
          │   (Analysis)    │    │  (Clustering)   │    │ (RSS Fetching)  │
          │                 │    │                 │    │                 │
          │• Article Analyze│    │• Embeddings     │    │• Periodic Fetch │
          │• Story Validate │    │• UMAP+HDBSCAN   │    │• Deduplication  │
          │• Intelligence   │    │• Auto-tuning    │    │• Queue Articles │
          │• Brief Generate │    │                 │    │                 │
          └─────────────────┘    └─────────────────┘    └─────────────────┘
                     ▲                        ▲                        │
                     │                        │                        ▼
                     └────────────────────────┼────────────────────────┐
                                              │                        │
                                              ▼                        ▼
                              ┌─────────────────────────────────────────────┐
                              │            Data Layer                       │
                              │                                             │
                              │  ┌─────────────────┐  ┌─────────────────┐  │
                              │  │   PostgreSQL    │  │   R2 Storage    │  │
                              │  │  + pgvector     │  │ (Content/Logs)  │  │
                              │  │                 │  │                 │  │
                              │  │• Article Meta   │  │• Full Content   │  │
                              │  │• Embeddings     │  │• Observability  │  │
                              │  │• Briefs         │  │• Media Files    │  │
                              │  └─────────────────┘  └─────────────────┘  │
                              └─────────────────────────────────────────────┘
                                              ▲
                                              │
                              ┌─────────────────────────────────────────────┐
                              │          Infrastructure                     │
                              │                                             │
                              │  ┌─────────────────┐  ┌─────────────────┐  │
                              │  │   Queues        │  │  Observability  │  │
                              │  │ (Async Proc.)   │  │   & Monitoring  │  │
                              │  └─────────────────┘  └─────────────────┘  │
                              └─────────────────────────────────────────────┘
```

### **Key Architectural Principles:**

- **🎯 Independent Service Calls**: Backend directly calls both AI Worker and ML Service independently - no chain dependencies
- **🔄 Workflow Orchestration**: Cloudflare Workflows coordinate multi-step processes with automatic retries and state management
- **⚡ Edge Computing**: Global distribution via Cloudflare Workers for low latency
- **📊 Separation of Concerns**: Clear boundaries between data ingestion, AI analysis, ML processing, and presentation
- **🔧 Service Isolation**: Each service can scale and deploy independently

## 🚀 Key Features

### Core Intelligence Pipeline
- **Multi-Source Ingestion**: Automated scraping of 100+ diverse RSS sources
- **Intelligent Content Extraction**: Handles paywalls, JavaScript rendering, and complex layouts
- **AI-Powered Analysis**: Multi-stage LLM processing using Google Gemini for deep content understanding
- **Advanced Clustering**: Semantic grouping using multilingual embeddings, UMAP, and HDBSCAN
- **Story Validation**: AI-driven filtering to identify coherent, newsworthy stories
- **Intelligence Synthesis**: Structured analysis with executive summaries, stakeholder mapping, and impact assessment

### Technical Excellence
- **Edge Computing**: Global distribution via Cloudflare Workers for low latency
- **Durable Execution**: Workflow orchestration with automatic retries and state management
- **Scalable Storage**: Efficient data architecture with PostgreSQL + R2 object storage
- **Comprehensive Monitoring**: Full observability with structured logging and performance metrics
- **Service-Oriented Architecture**: Modular design with clear separation of concerns

### User Experience
- **Clean Web Interface**: Modern Nuxt 3 frontend with responsive design
- **Interactive Briefings**: Table of contents, reading progress, and rich formatting
- **Admin Dashboard**: Source management, system monitoring, and briefing generation controls
- **API Access**: RESTful APIs for programmatic access to all functionality

## 🔄 How It Works

### **1. News Source Management & Scraping**
- **RSS Source Management**: Admin API (`/admin/sources`) manages RSS feed configurations
- **Durable Object Scrapers**: Each RSS source gets its own Durable Object with configurable frequency tiers
- **Intelligent Deduplication**: Automatic detection of new articles using database constraints
- **Queue-Based Processing**: New articles are queued for asynchronous content processing

### **2. Content Processing Workflow** (`ProcessArticles`)
- **Intelligent Content Extraction**:
  - Standard HTTP requests for regular sites
  - Browser rendering fallback for complex sites (anti-bot protection, paywalls, JavaScript-heavy)
  - Mozilla Readability for clean text extraction
- **AI-Powered Analysis** (via **AI Worker**):
  - Language detection and location extraction
  - Content quality assessment and thematic analysis  
  - Event summary extraction and entity identification
- **Content Storage**: Full article content stored in R2, metadata in PostgreSQL

### **3. Intelligence Brief Generation Workflow** (`AutoBriefGeneration`)

#### **Step 1: Dataset Preparation**
- Retrieves processed articles from PostgreSQL (with embeddings)
- Loads full content from R2 storage in parallel batches
- Applies quality filters and content validation

#### **Step 2: Clustering Analysis** (via **ML Service**)
- Backend calls ML Service independently with article embeddings
- UMAP dimensionality reduction + HDBSCAN clustering
- Automatic parameter optimization using DBCV metrics
- Returns clustered article groups

#### **Step 3: Story Validation** (via **AI Worker**)
- Backend calls AI Worker independently with clustering results
- AI evaluates each cluster for newsworthiness and coherence
- Filters out noise and identifies meaningful stories
- Returns validated stories with importance scores

#### **Step 4: Intelligence Analysis** (via **AI Worker**)
- Backend calls AI Worker for deep analysis of each validated story
- Generates comprehensive intelligence reports with:
  - Executive summaries and key developments
  - Stakeholder mapping and impact assessment
  - Timeline analysis and contradiction detection
  - Forward-looking outlook and implications

#### **Step 5: Brief Generation & TLDR** (via **AI Worker**)
- Backend calls AI Worker to synthesize intelligence reports
- Structured briefing generation with contextual continuity
- TLDR generation for quick consumption
- Final brief saved to PostgreSQL

### **4. Delivery & Presentation**
- **Web Interface**: Clean Nuxt 3 frontend with interactive navigation
- **Admin Dashboard**: Source management, briefing generation controls, system monitoring
- **OpenGraph Integration**: Social sharing with auto-generated images
- **API Access**: RESTful endpoints for programmatic access

## 🛠️ Technology Stack

### **Core Infrastructure**
- **Monorepo Management**: Turborepo with pnpm workspaces
- **Edge Computing**: Cloudflare Workers, Durable Objects, Workflows
- **Database**: PostgreSQL with Hyperdrive acceleration and pgvector for embeddings
- **Storage**: Cloudflare R2 for content and observability data
- **Queues**: Cloudflare Queues for asynchronous processing

### **Backend Services**
- **API Framework**: Hono.js for high-performance HTTP handling
- **ORM**: Drizzle for type-safe database interactions
- **Language**: TypeScript with strict type checking
- **Error Handling**: Neverthrow for functional error management
- **Validation**: Zod for runtime type validation

### **AI & Machine Learning**
- **Language Models**: Google Gemini 2.0 Flash and Gemini 2.5 Pro
- **Embeddings**: Multilingual E5-Small transformer model
- **Clustering**: UMAP + HDBSCAN with automatic parameter optimization
- **Content Processing**: Mozilla Readability + linkedom for DOM manipulation
- **ML Service**: FastAPI + PyTorch for embedding and clustering pipeline

### **Frontend**
- **Framework**: Nuxt 3 with Vue 3 composition API
- **Styling**: Tailwind CSS with Radix UI color system
- **Language**: TypeScript throughout
- **Deployment**: Cloudflare Pages with edge functions

### **DevOps & Monitoring**
- **CLI Tools**: Wrangler for Cloudflare deployment
- **Testing**: Vitest for unit testing, Miniflare for Workers simulation
- **Containerization**: Docker with multi-architecture support
- **Monitoring**: Structured logging, health checks, performance metrics

## 📋 Component Overview

### **Meridian Backend** (`apps/backend/`)
Core data ingestion, processing, and API layer built on Cloudflare Workers:
- **Source Management**: RSS feed handling with Durable Objects
- **Article Processing**: Intelligent content extraction and AI analysis
- **Workflow Orchestration**: Durable execution for complex multi-step processes
- **API Layer**: RESTful endpoints for all system functionality
- **Observability**: Comprehensive monitoring and logging infrastructure

### **Meridian AI Worker** (`services/meridian-ai-worker/`)
Specialized AI gateway service providing unified access to multiple AI providers:
- **Multi-Provider Support**: OpenAI, Anthropic, Google AI, Cloudflare Workers AI
- **Intelligent Routing**: Provider selection based on capability and performance
- **Enhanced Features**: Caching, cost tracking, retry mechanisms, quota handling
- **Business Logic**: Article analysis, story validation, intelligence synthesis, brief generation
- **Clean Architecture**: Layered design with clear separation of concerns

### **Meridian ML Service** (`services/meridian-ml-service/`)
Dedicated machine learning service for clustering and embedding generation:
- **High-Quality Embeddings**: Multilingual E5-Small model for semantic understanding
- **Advanced Clustering**: UMAP + HDBSCAN with automatic parameter optimization
- **Production Ready**: Docker containerized with health checks and monitoring
- **AI Worker Integration**: Seamless compatibility with existing backend formats
- **Scalable Architecture**: Modular pipeline supporting various deployment methods

### **Meridian Frontend** (`apps/frontend/`)
Modern web interface built with Nuxt 3:
- **Rich Briefing Display**: Interactive table of contents, reading progress tracking
- **Admin Interface**: Source management and system monitoring
- **Responsive Design**: Mobile-first approach with clean, professional styling
- **Performance Optimized**: Edge deployment with Cloudflare Pages

## 🚀 Getting Started

### **Prerequisites**
- Node.js v22+ with pnpm v9.15+
- Python 3.10+ (for ML service)
- PostgreSQL with pgvector extension
- Docker (optional, for containerized deployment)
- Cloudflare account with Workers enabled
- Google AI API key for Gemini models

### **Quick Setup**

1. **Clone and Install**:
```bash
git clone https://github.com/iliane5/meridian.git
cd meridian
pnpm install
```

2. **Database Setup**:
```bash
# Start PostgreSQL with pgvector (Docker)
docker run -p 5432:5432 -e POSTGRES_PASSWORD=password pgvector/pgvector:pg16

# Run migrations
pnpm --filter @meridian/database migrate

# Optional: Seed initial sources
pnpm --filter @meridian/database seed
```

3. **Environment Configuration**:
Create `.dev.vars` files in each service directory with required environment variables:
```bash
# Backend
DATABASE_URL=postgresql://user:password@localhost:5432/meridian
API_TOKEN=your-secure-api-token
GEMINI_API_KEY=your-gemini-api-key

# AI Worker
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_AI_GATEWAY_ID=your-gateway-id
OPENAI_API_KEY=your-openai-key
GOOGLE_AI_API_KEY=your-google-ai-key
```

4. **Start Development Services**:
```bash
# Backend
pnpm --filter @meridian/backend run dev

# AI Worker
pnpm --filter meridian-ai-worker run dev

# ML Service
cd services/meridian-ml-service && ./start_local.sh

# Frontend
pnpm --filter @meridian/frontend dev
```

5. **Initialize System**:
```bash
curl -X POST -H "Authorization: Bearer YOUR_API_TOKEN" \
  http://localhost:8787/do/admin/initialize-dos
```

### **Production Deployment**

1. **Configure Secrets**:
```bash
npx wrangler secret put DATABASE_URL
npx wrangler secret put API_TOKEN
npx wrangler secret put GEMINI_API_KEY
```

2. **Deploy Services**:
```bash
# Backend and AI Worker
npx wrangler deploy

# ML Service (Docker)
cd services/meridian-ml-service
./deploy-to-vps.sh --host user@your-vps-ip

# Frontend
# Deploy via Cloudflare Pages dashboard or Wrangler
```

## 📊 API Reference

### **Source Management**
```bash
# Create source
POST /admin/sources
{
  "url": "https://example.com/rss",
  "name": "Example News",
  "category": "technology",
  "scrape_frequency": 2
}

# Get all sources
GET /admin/sources

# Update source
PATCH /admin/sources/{id}

# Delete source
DELETE /admin/sources/{id}
```

### **Briefing Management**
```bash
# Get latest briefing
GET /reports/last-report

# Generate new briefing
POST /admin/briefs/generate

# Get briefing by ID
GET /reports/{id}
```

### **AI Worker APIs**
```bash
# Analyze article
POST /meridian/article/analyze

# Validate stories
POST /meridian/story/validate

# Generate intelligence
POST /meridian/intelligence/analyze-stories

# Generate brief
POST /meridian/generate-final-brief
```

### **ML Service APIs**
```bash
# Generate embeddings
POST /embeddings

# Cluster articles
POST /ai-worker/clustering

# Auto-format clustering
POST /clustering/auto
```

## 🔧 Configuration

### **Environment Variables**

**Backend Service:**
- `DATABASE_URL`: PostgreSQL connection string
- `API_TOKEN`: Authentication token for admin operations
- `GEMINI_API_KEY`: Google AI API key
- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account identifier
- `MERIDIAN_ML_SERVICE_URL`: ML service endpoint

**AI Worker:**
- `CLOUDFLARE_AI_GATEWAY_ID`: AI Gateway for request proxying
- `OPENAI_API_KEY`: OpenAI API access
- `ANTHROPIC_API_KEY`: Anthropic API access
- `GOOGLE_AI_API_KEY`: Google AI Studio access

**ML Service:**
- `API_TOKEN`: Service authentication token
- `EMBEDDING_MODEL_NAME`: Transformer model identifier
- `LOG_LEVEL`: Logging verbosity

### **Cloudflare Bindings**

**Required Bindings** (configured in `wrangler.jsonc`):
- **Durable Objects**: `SOURCE_SCRAPER` for stateful source management
- **Queues**: `ARTICLE_PROCESSING_QUEUE` for async processing
- **R2 Buckets**: `ARTICLES_BUCKET` for content storage
- **Workflows**: `PROCESS_ARTICLES`, `AUTO_BRIEF_GENERATION`
- **Service Bindings**: `MERIDIAN_AI_WORKER` for AI operations
- **AI Binding**: `AI` for Cloudflare Workers AI access

## 📈 Monitoring & Observability

### **Available Endpoints**
- `/health`: Service health status
- `/admin/overview`: System statistics and performance
- `/observability/workflows`: Workflow execution monitoring
- `/observability/dashboard`: Comprehensive system dashboard
- `/observability/quality/analysis`: Data quality assessment

### **Key Metrics**
- Article processing success rates and performance
- AI analysis quality scores and cost tracking
- Briefing generation frequency and user engagement
- Source reliability and freshness metrics
- System performance and resource utilization

### **Logging & Debugging**
- Structured JSON logging throughout the pipeline
- Request/response tracing with correlation IDs
- Performance profiling and bottleneck identification
- Error categorization and alerting

## 🧪 Testing

### **Development Testing**
```bash
# Backend unit tests
pnpm --filter @meridian/backend test

# AI Worker tests
pnpm --filter meridian-ai-worker test

# ML Service tests
cd services/meridian-ml-service && pytest

# Frontend tests
pnpm --filter @meridian/frontend test
```

### **Integration Testing**
- End-to-end workflow validation
- AI Worker integration with backend
- ML Service clustering verification
- API contract testing

## 🎯 Current Status & Roadmap

### **✅ Completed**
- ✅ **Core Pipeline**: Full news processing and analysis pipeline
- ✅ **AI Integration**: Multi-provider AI gateway with sophisticated analysis
- ✅ **ML Capabilities**: Advanced clustering and embedding generation
- ✅ **Web Interface**: Professional frontend with admin capabilities
- ✅ **Observability**: Comprehensive monitoring and logging
- ✅ **Deployment**: Production-ready with Cloudflare infrastructure

### **🔄 In Progress**
- 🔄 **Automation**: Fully automated briefing generation (replacing manual Python notebooks)
- 🔄 **Reliability**: Enhanced error handling and recovery mechanisms
- 🔄 **Performance**: Optimization of processing pipeline and resource usage

### **🔮 Future Enhancements**
- 📧 **Distribution**: Email newsletter and notification system
- 🎯 **Personalization**: User-specific content filtering and preferences
- 📊 **Analytics**: Advanced metrics and user behavior tracking
- 🌐 **Multi-language**: Support for non-English sources and analysis
- 🔌 **Integrations**: Slack, Discord, and other platform connectors

## 🤖 AI Collaboration

This project represents a significant collaboration between human engineering and artificial intelligence:

### **AI Development Partners**
- **Claude 3.5 Sonnet**: Architecture design, code generation, prompt refinement, and engineering oversight
- **Gemini 2.0 Flash**: The production workhorse enabling economically viable large-scale analysis
- **Gemini 2.5 Pro**: Long-context analysis, codebase review, and analytical tone development

### **AI Impact**
The AI collaboration wasn't just about productivity—it fundamentally enabled the project's existence. No human team could economically process 2000+ daily articles and analyze 100+ story clusters at the scale and cost efficiency that Meridian achieves. This represents a new paradigm where AI isn't just assisting human work, but enabling entirely new categories of applications that were previously impossible.

## 🤝 Contributing

1. **Fork the Repository**: Create your own copy of the codebase
2. **Create Feature Branch**: `git checkout -b feature/amazing-feature`
3. **Make Changes**: Implement your feature with appropriate tests
4. **Test Thoroughly**: Ensure all tests pass and functionality works
5. **Submit Pull Request**: Provide clear description of changes and benefits

### **Development Guidelines**
- Follow TypeScript strict mode requirements
- Write comprehensive tests for new functionality
- Update documentation for API changes
- Follow established code style and patterns
- Consider performance and security implications

## 📄 License

MIT License - See [LICENSE](./LICENSE) file for complete details.

## 🆘 Support & Community

- **Documentation**: Comprehensive guides in each service directory
- **Issues**: GitHub Issues for bug reports and feature requests
- **Discussions**: GitHub Discussions for community questions
- **API Documentation**: Available at service endpoints (`/docs`)

---

**Meridian: Because we live in an age of magic, and we should use it wisely.**

*Transform information overload into strategic intelligence. Built for those who need to understand what matters, when it matters.*
