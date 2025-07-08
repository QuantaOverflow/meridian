# Meridian AI Worker

Meridian AI Worker is an AI gateway service built on Cloudflare Workers, designed to provide a unified AI service interface for the Meridian Intelligence Brief System. It supports interaction with multiple AI providers (OpenAI, Anthropic, Google AI, Cloudflare Workers AI) and integrates enterprise-grade features including authentication, cost tracking, intelligent caching, and enhanced monitoring.

## System Architecture Overview

Meridian AI Worker adopts a clear layered architecture with well-defined responsibilities, featuring excellent modularity and extensibility. The core design philosophy is to abstract the differences between underlying AI providers through a unified AI Gateway service, achieving high maintainability and flexibility.

```
┌───────────────────────────────────────────────┐
│              HTTP Routes (index.ts)           │  (API endpoints, request parsing, response handling)
├───────────────────────────────────────────────┤
│                  Service Layer                │  (Core business logic, AI capability coordination, provider calls)
│  ┌───────────────────────────────────────────┐│
│  │ AIGatewayService (Core AI request dispatch & enhancement) ││
│  │ IntelligenceService (Intelligence analysis workflow)      ││
│  │ BriefGenerationService (Brief generation workflow)       ││
│  │ StoryValidationService (Story validation workflow)       ││
│  │ AuthenticationService (Authentication & authorization)    ││
│  │ RetryService (Retry mechanisms)                         ││
│  │ Logger, MetadataService (Logging & metadata)            ││
│  └───────────────────────────────────────────┘│
├───────────────────────────────────────────────┤
│                 Provider Layer                │  (AI provider adapters, unified request/response format)
│  ┌───────────────────────────────────────────┐│
│  │ OpenAIProvider │ AnthropicProvider │        ││
│  │ GoogleAIProvider │ WorkersAIProvider │ MockProvider ││
│  └───────────────────────────────────────────┘│
├───────────────────────────────────────────────┤
│               Capability Layer                │  (Specific AI capability request building & response parsing)
│  ┌───────────────────────────────────────────┐│
│  │ ChatCapability │ EmbeddingCapability │ ImageCapability ││
│  │ VideoCapability │ TextToSpeechCapability │ LiveAudioCapability │ etc. ││
│  └───────────────────────────────────────────┘│
└───────────────────────────────────────────────┘
                                   ↓
                       Cloudflare AI Gateway (Unified entry, caching, cost tracking, monitoring)
                                   ↓
                       AI Models (GPT-4, Gemini, Llama, Claude, BGE-M3, etc.)
```

### Design Principles

- **Layered Architecture**: Application logic is divided into clear layers for easy understanding and maintenance
- **Adapter Pattern**: Through `AbstractProvider` and its concrete implementations, unifies interfaces across different AI providers
- **Strategy Pattern**: `CapabilityHandler` defines specific processing logic for each AI capability
- **Single Responsibility Principle**: Each service and module focuses on a single function
- **Configuration-Driven**: Centralized management of AI model and provider configurations for easy extension
- **Robustness**: Built-in retry mechanisms, error handling, and logging

## Tech Stack

- **Platform**: Cloudflare Workers
- **Programming Language**: TypeScript
- **Web Framework**: Hono (lightweight, high-performance)
- **Runtime Compatibility**: Node.js compatibility mode (`nodejs_compat`)
- **Package Management**: npm (or pnpm)
- **Testing Framework**: Vitest (unit testing, integration testing), Miniflare (Workers environment simulation)
- **Deployment Tool**: Cloudflare Wrangler CLI
- **Data Validation**: Zod (for API request and response contract validation)
- **AI Gateway**: Cloudflare AI Gateway (unified proxy for all AI requests)
- **AI Providers**: OpenAI, Anthropic, Google AI Studio, Cloudflare Workers AI

## Core Components & Modules

### Entry Point
- **`src/index.ts`**: Application entry point defining all external HTTP API endpoints
  - Routes requests to appropriate service layer handlers
  - Performs basic request validation
  - Constructs unified API response format

### Services (`src/services/`)

#### `ai-gateway.ts` (`AIGatewayService`)
- **Purpose**: System core, acting as unified dispatcher and enhancer for all AI requests
- **Functionality**: Selects appropriate `BaseProvider` based on request capability and provider, builds requests compatible with Cloudflare AI Gateway universal endpoint format, executes HTTP calls, and parses responses
- **Key Responsibilities**: AI request routing, traffic control, external AI API abstraction

#### Provider Layer (`services/providers/`)
- **Purpose**: Adapts different AI providers, providing unified API call interfaces
- **Functionality**: `AbstractProvider` defines common methods for all providers (getting supported capabilities and models, building request bodies, parsing responses)
- **Implementations**: `OpenAIProvider`, `AnthropicProvider`, `GoogleAIProvider`, `WorkersAIProvider`

#### `auth.ts` (`AuthenticationService`)
- **Purpose**: Handles API request authentication and authorization
- **Functionality**: Validates API keys, checks request origins (CORS), handles preflight requests
- **Key Responsibilities**: Security control, API access management

#### `logger.ts` (`Logger`)
- **Purpose**: Provides unified, structured logging functionality
- **Functionality**: Supports different log levels (debug, info, warn, error), records request/response, errors, and performance metrics
- **Key Responsibilities**: System observability, problem diagnosis

#### `metadata.ts` (`MetadataService`)
- **Purpose**: Creates and manages request metadata for tracking, monitoring, and analysis
- **Functionality**: Extracts user information, IP addresses, User-Agent from HTTP requests, adds processing information
- **Key Responsibilities**: Data tracking, performance analysis, error attribution

#### `retry.ts` (`RetryService`)
- **Purpose**: Provides automatic retry mechanisms for unstable external calls
- **Functionality**: Implements exponential backoff strategy with jitter to avoid thundering herd effects
- **Key Responsibilities**: Improves system reliability, reduces transient failure impact

#### Business Logic Services
- **`brief-generation.ts`**: Generates final intelligence briefs and summaries from intelligence analysis reports
- **`intelligence.ts`**: Performs deep intelligence analysis on validated stories
- **`story-validation.ts`**: Validates whether article clusters constitute meaningful "stories"

### Capabilities (`src/capabilities/`)
- **Purpose**: Defines request building and response parsing logic for each AI capability
- **Functionality**: `CapabilityHandler` interface defines `buildProviderRequest` and `parseProviderResponse` methods
- **Implementations**: `ChatCapabilityHandler`, `EmbeddingCapabilityHandler`, etc.

### Configuration (`src/config/providers.ts`)
- **Purpose**: Centralized management of all AI provider and model configurations
- **Functionality**: Contains provider names, base URLs, auth headers, default models, and detailed model information
- **Key Responsibilities**: Global configuration, model capability definition

### Prompts (`src/prompts/`)
- **Purpose**: Stores all AI prompt templates
- **Functionality**: Provides reusable functions for generating prompts for article analysis, story validation, intelligence analysis, and brief generation
- **Key Responsibilities**: AI interaction content management

### Types (`src/types/`)
- **Purpose**: Defines TypeScript types used throughout the application
- **Functionality**: Includes common API responses, unified AI request/response interfaces, provider configurations, and business domain data contracts
- **Key Responsibilities**: Ensures code type safety, defines data contracts

### Utilities (`src/utils/`)
- **Purpose**: Contains common utility functions
- **Functionality**: Includes AI response JSON parsing, text token limiting, article Markdown formatting, and quota handling logic
- **Key Responsibilities**: Common logic encapsulation, code reuse

## Data Flow & Business Logic

The core business logic revolves around the "Intelligence Brief Generation Workflow":

1. **Initial Data Preparation**: External systems provide `ArticleDataset` containing raw article content and embeddings
2. **Article Analysis** (`POST /meridian/article/analyze`): Structured analysis of articles using AI
3. **Embedding Generation** (`POST /meridian/embeddings/generate`): Generate vector embeddings for text
4. **Clustering** (external): ML service groups related articles into clusters
5. **Story Validation** (`POST /meridian/story/validate`): Validate if clusters constitute coherent "stories"
6. **Intelligence Analysis** (`POST /meridian/intelligence/analyze-stories`): Deep AI analysis of validated stories
7. **Brief Generation** (`POST /meridian/generate-final-brief`): Synthesize intelligence reports into comprehensive daily briefings
8. **TLDR Generation** (`POST /meridian/generate-brief-tldr`): Generate concise summaries of briefs
9. **General Chat** (`POST /meridian/chat`): General-purpose AI conversation

## API Endpoints

### Core Endpoints
- `POST /meridian/article/analyze` - Analyze individual articles
- `POST /meridian/embeddings/generate` - Generate text embeddings
- `POST /meridian/story/validate` - Validate article clusters as stories
- `POST /meridian/intelligence/analyze-stories` - Analyze multiple stories
- `POST /meridian/intelligence/analyze-single-story` - Analyze single story
- `POST /meridian/generate-final-brief` - Generate comprehensive brief
- `POST /meridian/generate-brief-tldr` - Generate brief summary
- `POST /meridian/chat` - General AI chat

### Utility Endpoints
- `GET /health` - Health check
- `GET /` - Service information

## Integration Points

- **HTTP API**: RESTful API endpoints for external integration
- **Environment Variables**: Configuration via Cloudflare Workers environment variables
- **Cloudflare AI Gateway**: All AI requests proxy through AI Gateway for caching, cost tracking, and monitoring
- **AI Provider APIs**: Internal integration with OpenAI, Anthropic, Google AI, and Cloudflare Workers AI
- **CORS**: Cross-origin request handling via Hono middleware
- **Logging/Monitoring**: Structured logging to Cloudflare Workers platform
- **External ML Services**: Integration with external services for embedding generation and clustering

## Dependencies

- **`hono`**: Lightweight web framework for Workers routing and HTTP handling
- **`zod`**: TypeScript-first schema declaration and validation library
- **`@cloudflare/workers-types`**: TypeScript definitions for Cloudflare Workers APIs
- **`vitest`**: Next-generation testing framework for unit and integration tests
- **`miniflare`**: Local Cloudflare Workers simulator for testing
- **`wrangler`**: Official Cloudflare CLI tool for development and deployment

## Design Patterns

- **Abstract Factory/Strategy Pattern**: Dynamic selection of AI providers and processing strategies
- **Template Method Pattern**: Common AI request processing flow with provider-specific implementations
- **Chain of Responsibility**: Request processing through authentication, metadata enhancement, AI Gateway enhancement, retry mechanisms
- **Singleton Pattern**: Shared service instances (Logger, AuthenticationService, etc.)
- **Dependency Injection**: Constructor-based dependency injection for loose coupling
- **Configuration as Code**: TypeScript-based configuration management
- **High Cohesion, Low Coupling**: Well-defined module boundaries with clear interfaces
- **Observability First**: Built-in logging and metadata collection for monitoring and diagnostics

## Development & Deployment

### Prerequisites
- Node.js 18+ with npm or pnpm
- Cloudflare account with Workers enabled
- Wrangler CLI installed globally

### Local Development
```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm test

# Type checking
npm run type-check
```

### Deployment
```bash
# Deploy to Cloudflare Workers
npm run deploy

# Deploy to specific environment
wrangler deploy --env production
```

### Environment Variables
Configure the following variables in your Cloudflare Workers environment:
- `CLOUDFLARE_ACCOUNT_ID` - Your Cloudflare account ID
- `CLOUDFLARE_AI_GATEWAY_ID` - AI Gateway ID for request proxying
- `OPENAI_API_KEY` - OpenAI API key
- `ANTHROPIC_API_KEY` - Anthropic API key
- `GOOGLE_AI_API_KEY` - Google AI Studio API key
- `MERIDIAN_API_KEY` - Authentication key for API access

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes with appropriate tests
4. Ensure all tests pass
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Architecture Documentation

For detailed architecture documentation, design patterns, and integration guides, see:
- `docs/ARCHITECTURE.md` - System architecture and design patterns
- `docs/API_GUIDE.md` - Detailed API usage guide
- `docs/workflow_integration.md` - End-to-end workflow integration