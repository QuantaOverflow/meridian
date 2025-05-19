# Meridian Backend Worker (`@meridian/backend`)

This Cloudflare Worker application forms the core data ingestion, processing, and API layer for the Meridian project. It handles fetching news sources, orchestrating article content scraping, performing AI analysis, managing data persistence, and providing API endpoints.

It leverages several Cloudflare platform features for resilience and scalability:

- **Workers:** Runs the Hono API server, queue consumer logic, Workflow triggers, and Durable Object interactions.
- **Durable Objects (`SourceScraperDO`):** Manages the state and scheduled fetching for individual news sources via Alarms.
- **Queues (`article-processing-queue`):** Decouples the initial lightweight source check from the more intensive article processing.
- **Workflows (`ProcessArticles`):** Provides durable, multi-step execution for scraping, analyzing, and storing article content, handling retries automatically.
- **R2:** Stores full article text content.

## Key Components

1.  **Hono API Server (`app.ts`):**

    - Provides HTTP endpoints for:
      - Managing reports (`/reports`).
      - Managing sources (`/sources` - e.g., creation, updating, deletion).
      - Generating OpenGraph images (`/openGraph`).
      - Retrieving events data (`/events` - formatted article content for client consumption).
      - Internal/Admin operations (DO initialization `POST /do/admin/initialize-dos`).
      - Health check (`/ping`).
    - Handles routing requests to specific `SourceScraperDO` instances (`GET /do/source/:sourceId/*`).
    - Uses Bearer Token authentication (`API_TOKEN`) for protected routes (`hasValidAuthToken`).

2.  **Source Scraper Durable Object (`SourceScraperDO`):**

    - One instance per news source URL (`idFromName(url)`).
    - Uses Cloudflare Alarms (`ctx.storage.setAlarm`) for scheduled, periodic RSS feed checks based on frequency tiers.
    - Fetches and parses RSS feeds (`parseRSSFeed`), handling various formats and cleaning URLs/content.
    - Uses `ON CONFLICT DO NOTHING` to efficiently insert only new article metadata (URL, title, source ID, publish date) into the database.
    - Sends batches of newly inserted article database IDs to the `ARTICLE_PROCESSING_QUEUE`.
    - Implements robust retries with exponential backoff (`attemptWithRetries`) for fetching, parsing, and DB insertion.
    - Validates and stores its state (`SourceState`: sourceId, url, frequency, lastChecked) in Durable Object storage, protecting against corruption.
    - Includes a `destroy` method for cleanup.

3.  **Article Processing Queue (`article-processing-queue`):**

    - Receives messages containing batches of article IDs needing full processing.
    - The queue consumer (`queue` handler in `index.ts`) aggregates IDs from the batch.
    - Triggers the `ProcessArticles` Workflow to handle the actual processing for the aggregated IDs.
    - Configured with settings like `max_batch_size`, `max_retries`, and a Dead Letter Queue (`article-processing-dlq`).

4.  **Process Articles Workflow (`ProcessArticles`):**

    - Receives a list of article IDs from the queue consumer trigger.
    - Fetches necessary article details (URL, title, publish date) from the database, filtering for recent, unprocessed, non-failed articles.
    - Uses a `DomainRateLimiter` to manage scraping politeness and concurrency across different source domains.
    - Scrapes full article content using `step.do` for durable, retried execution:
      - Attempts direct `fetch` (`getArticleWithFetch`) first.
      - Falls back to the Cloudflare Browser Rendering API (`getArticleWithBrowser`) for tricky domains (`TRICKY_DOMAINS`) or initial fetch failures. This involves executing JavaScript snippets via `addScriptTag` to bypass cookie consents, paywalls, and clean the DOM before extraction.
      - Uses `@mozilla/readability` (`parseArticle`) to extract the core article text from the scraped HTML.
    - Handles PDF links by marking them as `SKIPPED_PDF` in the database.
    - Sends the extracted title and text to Google Gemini (`gemini-2.0-flash`) via `@ai-sdk/google` (`generateObject`) for structured analysis based on `articleAnalysis.prompt.ts` and `articleAnalysisSchema`.
    - Generates embeddings for the processed content using an external ML service (`createEmbeddings`).
    - Uploads the extracted article text to R2 (`ARTICLES_BUCKET`).
    - Updates the corresponding articles in the database with the analysis results (language, keywords, entities, summary, etc.), embedding vector, R2 key, and final status (`PROCESSED`), or marks them with a specific failure status (`FETCH_FAILED`, `RENDER_FAILED`, `AI_ANALYSIS_FAILED`, `EMBEDDING_FAILED`, `R2_UPLOAD_FAILED`) and `failReason`.
    - Leverages Workflow steps (`step.do`, `step.sleep`) for automatic retries, durability, and managing execution state.

5.  **Core Libraries & Utilities (`src/lib`):**

    - `articleFetchers.ts`: Contains logic for `getArticleWithFetch` and `getArticleWithBrowser`, including the browser rendering script definitions.
    - `embeddings.ts`: Interface for generating embeddings via the external ML service.
    - `logger.ts`: Simple structured JSON logger class for Cloudflare Logs.
    - `parsers.ts`: Includes `parseRSSFeed` and `parseArticle` (using `Readability` and `linkedom`).
    - `rateLimiter.ts`: Implements the `DomainRateLimiter`.
    - `tryCatchAsync.ts`: Utility for converting promise rejections to `neverthrow` Results.
    - `utils.ts`: Helper functions like `getDb` (with `prepare: false`), `hasValidAuthToken`, `generateSearchText`.
    - `test-cloudflare.ts`: Utility script for directly testing the Cloudflare Browser Rendering API, useful for troubleshooting scraping issues.

6.  **Events API (`events.router.ts`):**

    - Provides formatted article data for client-side consumption
    - Implements pagination for efficient data retrieval
    - Formats article content by retrieving the full text from R2 storage
    - Processes event summaries from various formats (array, JSON, string)
    - Maps database quality indicators to client-friendly relevance scores

7.  **Integrations:**
    - **Database (`@meridian/database`):** Uses Drizzle ORM and `postgres.js` to interact with the PostgreSQL database. Configured with `prepare: false` for pooler compatibility.
    - **Cloudflare Browser Rendering API:** Used as a fallback mechanism for robust scraping.
    - **Google AI (Gemini):** Used for core article analysis.
    - **External ML Service:** Used via `MERIDIAN_ML_SERVICE_URL` for generating embeddings.

## How It Works (High-Level Flow)

1.  **Initialization:** (If needed) The `/do/admin/initialize-dos` endpoint is called to create/update `SourceScraperDO` instances based on sources in the database.
2.  **Scheduled Fetch:** A `SourceScraperDO` instance's alarm triggers.
3.  **RSS Processing:** The DO fetches its RSS feed, parses it, and inserts basic metadata for new articles using `ON CONFLICT DO NOTHING`.
4.  **Queueing:** The DO sends the database IDs of newly inserted articles to the `ARTICLE_PROCESSING_QUEUE`.
5.  **Queue Consumption:** The Worker's `queue` handler receives a batch of article IDs.
6.  **Workflow Trigger:** The `queue` handler triggers the `ProcessArticles` Workflow with the batch of IDs.
7.  **Content Scraping & Parsing:** The Workflow fetches article details, scrapes the full content using the rate limiter and appropriate method (fetch/browser), and parses it using Readability.
8.  **AI Analysis & Embeddings:** The Workflow sends content to Gemini for analysis and generates embeddings via the ML service.
9.  **Storage:** The Workflow uploads article text to R2.
10. **DB Update:** The Workflow updates the articles in the database with the analysis results, R2 key, embedding, and final status.
11. **API Access:** The Hono API server allows querying processed data or performing management actions.
12. **Events Access:** Client applications can retrieve formatted article content through the `/events` API endpoint.

## Configuration

Configuration relies on `wrangler.jsonc` for infrastructure bindings and environment variables/secrets for credentials and runtime parameters.

### `wrangler.jsonc` Highlights

Ensure the following bindings and configurations are correctly set up:

- **`durable_objects`:** Binding `SOURCE_SCRAPER` to `SourceScraperDO` class, plus `migrations` definition.
- **`queues`:** Producer binding `ARTICLE_PROCESSING_QUEUE` and Consumer config for `article-processing-queue` (pointing to the Worker).
- **`r2_buckets`:** Binding `ARTICLES_BUCKET` to your R2 bucket name.
- **`workflows`:** Binding `PROCESS_ARTICLES` to `ProcessArticles` class.
- **`compatibility_date` / `compatibility_flags`:** Set appropriately (e.g., `nodejs_compat`).
- **`observability`:** Enabled for better monitoring.

### Environment Variables & Secrets

The following are required (use `.dev.vars` locally, Cloudflare Secrets in production):

- `DATABASE_URL`: PostgreSQL connection string.
- `API_TOKEN`: Secret Bearer token for protecting API endpoints.
- `CLOUDFLARE_ACCOUNT_ID`: Your Cloudflare account ID.
- `CLOUDFLARE_API_TOKEN`: API token with Browser Rendering permissions.
- `GEMINI_API_KEY`: API key for Google AI (Gemini).
- `GEMINI_BASE_URL`: (Optional) Custom base URL for Google AI API.
- `MERIDIAN_ML_SERVICE_URL`: URL for the external embeddings service.
- `MERIDIAN_ML_SERVICE_API_KEY`: API token for the external embeddings service.

## Development Tools

1. **Testing Cloudflare Browser Rendering API**
   - The codebase includes a direct testing utility (`test-cloudflare.ts`) for troubleshooting Cloudflare Browser Rendering API.
   - This tool helps debug scraping issues by directly testing the API outside of the Worker context.
   - Usage: Configure the required environment variables (`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`) and run the script.

2. **API Testing Hooks**
   - The Worker includes test mode hooks accessible via URL query parameters (`?_test=gemini` or `?_test=cfai`).
   - These hooks allow testing specific API integrations without going through the full workflow.

## API 管理端点

以下是用于管理系统各组件的 API 端点，可通过 curl 命令直接访问：

### 新闻源管理

#### 创建新的新闻源

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/rss",
    "name": "示例新闻源",
    "category": "news",
    "scrape_frequency": 2,
    "paywall": false
  }' \
  http://localhost:8787/sources
```

#### 更新现有新闻源

```bash
curl -X PATCH \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "更新的源名称",
    "scrape_frequency": 3,
    "category": "technology"
  }' \
  http://localhost:8787/sources/123
```

#### 删除新闻源

```bash
curl -X DELETE \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  http://localhost:8787/sources/123
```

#### 查询所有新闻源

```bash
curl -X GET \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  http://localhost:8787/sources
```

### Durable Object 管理

#### 初始化特定新闻源的 Durable Object

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  http://localhost:8787/do/admin/source/123/init
```

#### 初始化所有未初始化的新闻源

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  http://localhost:8787/do/admin/initialize-dos
```

#### 获取新闻源状态信息

```bash
curl -X GET \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  http://localhost:8787/do/source/123/state
```

#### 手动触发新闻源抓取

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  http://localhost:8787/do/source/123/fetch
```

注意：在以上所有命令中，请将 `YOUR_API_TOKEN` 替换为您的实际 API 令牌，并将 `123` 替换为实际的新闻源 ID。

## Running Locally

1.  Ensure Node.js (v22+), pnpm (v9.15+), Docker (for Postgres+pgvector), and Wrangler are installed.
2.  Navigate to the monorepo root (`meridian/`).
3.  Install dependencies: `pnpm install`.
4.  Start a local PostgreSQL database with the pgvector extension (see README.MD or use Supabase local dev).
5.  Configure and run database migrations:
    - Set `DATABASE_URL` in .env.
    - Run `pnpm --filter @meridian/database migrate`.
    - (Optional) Seed initial sources: `pnpm --filter @meridian/database seed`.
6.  Create a `.dev.vars` file in backend and populate the required environment variables listed above.
7.  Start the local development server: `pnpm --filter @meridian/backend run dev`.
    - This uses `wrangler dev` with local emulation.
    - Local emulation for DOs, Queues, and Workflows has limitations.
8.  **Initialize Durable Objects:** Manually trigger the DO initialization endpoint once after starting the server and seeding sources:
    ```bash
    curl -X POST -H "Authorization: Bearer YOUR_API_TOKEN" http://localhost:8787/do/admin/initialize-dos
    ```
    Replace `YOUR_API_TOKEN` with the value from your `.dev.vars`.

## Testing

Unit tests for core utilities and parsers are located in the `test/` directory and can be run with `pnpm --filter @meridian/backend run test`. Integration or end-to-end testing involving Workers, DOs, and Workflows locally can be complex but may be valuable future additions.

## Deployment

Deployment is handled via Cloudflare Wrangler:

1.  Ensure `wrangler.jsonc` is correct for the target environment.
2.  Set production secrets using `npx wrangler secret put <SECRET_NAME>`.
3.  Deploy using `npx wrangler deploy` from within the backend directory or via configured CI/CD.

## Key Libraries & Technologies

- **Hono:** Web framework for the API server.
- **Drizzle ORM:** TypeScript ORM for database interactions.
- **postgres.js:** PostgreSQL client library.
- **Neverthrow:** Functional error handling.
- **Zod:** Schema validation.
- **@ai-sdk/google:** SDK for interacting with Google Gemini.
- **@mozilla/readability:** Core library for article content extraction.
- **linkedom:** DOM parser used with Readability.
- **fast-xml-parser:** For parsing RSS feeds.
- **Vitest:** Unit testing framework.
- **Cloudflare Workers, Durable Objects, Queues, Workflows, R2**