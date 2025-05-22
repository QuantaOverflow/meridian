import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { Env } from './types';
import { modelRouter } from './router/modelRouter';
import { gatewayRouter } from './router/gatewayRouter';
import { auth } from './middleware/auth';
import { errorHandler } from './utils/errorHandler';

// 创建应用实例
const app = new Hono<{ Bindings: Env }>();

// 全局中间件
app.use('*', logger());
app.use('/api/*', auth());
app.use('*', errorHandler());

// 健康检查
app.get('/', (c) => {
  const env = c.env.ENVIRONMENT || 'development';
  
  return c.json({
    status: 'ok',
    service: 'meridian-ai-worker',
    version: '0.1.0',
    environment: env,
    timestamp: new Date().toISOString()
  });
});

// API 文档
app.get('/docs', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Meridian AI Worker API 文档</title>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          body { font-family: system-ui, sans-serif; max-width: 1000px; margin: 0 auto; padding: 20px; line-height: 1.5; }
          h1 { color: #333; margin-bottom: 20px; }
          h2 { color: #444; margin-top: 30px; padding-bottom: 5px; border-bottom: 1px solid #eee; }
          h3 { color: #666; margin-top: 20px; }
          pre, code { background: #f7f7f7; padding: 2px 6px; border-radius: 3px; font-size: 14px; }
          pre { padding: 15px; overflow-x: auto; }
          table { border-collapse: collapse; width: 100%; margin: 15px 0; }
          th, td { text-align: left; padding: 8px; border: 1px solid #ddd; }
          th { background-color: #f7f7f7; }
          .method { display: inline-block; padding: 2px 6px; border-radius: 3px; font-weight: bold; font-size: 12px; }
          .method.get { background: #e7f5ff; color: #0069d9; }
          .method.post { background: #e3fcef; color: #00a651; }
          .endpoint { font-family: monospace; margin-left: 10px; }
          .param-name { font-weight: bold; }
          .param-type { color: #6c757d; font-size: 14px; }
          .param-required { color: #dc3545; }
          .param-optional { color: #6c757d; }
          .response-example { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 10px 0; }
          .tab { margin-left: 20px; }
          .info { background: #e7f5ff; padding: 10px; border-radius: 4px; margin: 15px 0; }
        </style>
      </head>
      <body>
        <h1>Meridian AI Worker API 文档</h1>
        <p>统一的 AI 服务接口，支持多种模型和任务类型。通过集成 Cloudflare AI Gateway，可以访问 OpenAI、Google、Anthropic 和 Cloudflare 等提供商的 AI 能力。</p>
        
        <div class="info">
          <strong>认证要求：</strong> 所有 API 请求需要使用 <code>Authorization: Bearer API_AUTH_KEY</code> 进行身份验证
        </div>
        
        <h2>API 端点</h2>
        
        <h3>健康检查</h3>
        <div><span class="method get">GET</span><span class="endpoint">/api/health</span></div>
        <p>检查 API 服务是否正常运行。</p>
        <div class="response-example">
          <pre><code>{
  "success": true,
  "data": {
    "status": "healthy",
    "timestamp": "2025-05-23T12:34:56.789Z"
  }
}</code></pre>
        </div>
        
        <h3>系统状态</h3>
        <div><span class="method get">GET</span><span class="endpoint">/api/status</span></div>
        <p>获取系统详细状态，包括性能指标和可用提供商。</p>
        <div class="response-example">
          <pre><code>{
  "success": true,
  "data": {
    "status": "operational",
    "environment": "production",
    "timestamp": "2025-05-23T12:34:56.789Z",
    "metrics": { ... },
    "providers": {
      "openai": true,
      "google": true,
      "anthropic": false,
      "cloudflare": true
    }
  }
}</code></pre>
        </div>
        
        <h3>文章分析</h3>
        <div><span class="method post">POST</span><span class="endpoint">/api/gateway/analyze-article</span></div>
        <p>分析文章内容，提取主题、关键实体、情感倾向等信息。</p>
        
        <h4>请求参数</h4>
        <table>
          <tr>
            <th>参数名</th>
            <th>类型</th>
            <th>必须</th>
            <th>描述</th>
          </tr>
          <tr>
            <td class="param-name">title</td>
            <td class="param-type">string</td>
            <td class="param-required">是</td>
            <td>文章标题</td>
          </tr>
          <tr>
            <td class="param-name">content</td>
            <td class="param-type">string</td>
            <td class="param-required">是</td>
            <td>文章内容</td>
          </tr>
          <tr>
            <td class="param-name">model</td>
            <td class="param-type">string</td>
            <td class="param-optional">否</td>
            <td>指定使用的模型，如不提供则使用默认模型（推荐 gpt-4o 或 gemini-2.0-flash）</td>
          </tr>
          <tr>
            <td class="param-name">options</td>
            <td class="param-type">object</td>
            <td class="param-optional">否</td>
            <td>附加选项，如温度等</td>
          </tr>
        </table>
        
        <h4>请求示例</h4>
        <div class="response-example">
          <pre><code>{
  "title": "新型人工智能技术突破",
  "content": "研究人员今天宣布了一项重大突破...",
  "model": "gpt-4o"
}</code></pre>
        </div>
        
        <h4>响应示例</h4>
        <div class="response-example">
          <pre><code>{
  "success": true,
  "data": {
    "language": "zh",
    "primary_location": "GLOBAL",
    "completeness": "COMPLETE",
    "content_quality": "OK",
    "event_summary_points": ["研究人员宣布AI突破", "..."],
    "thematic_keywords": ["人工智能", "技术创新", "..."],
    "topic_tags": ["AI", "研究", "..."],
    "key_entities": ["研究人员", "..."],
    "content_focus": ["Technology", "Science"]
  },
  "meta": {
    "requestId": "a323353b-57db-47c0-9173-43d30f7b614c",
    "processedAt": "2025-05-23T12:34:56.789Z",
    "processingTimeMs": 1234
  }
}</code></pre>
        </div>
        
        <h3>生成嵌入向量</h3>
        <div><span class="method post">POST</span><span class="endpoint">/api/gateway/embedding</span></div>
        <p>为文本生成嵌入向量，用于相似度匹配和语义搜索。</p>
        
        <h4>请求参数</h4>
        <table>
          <tr>
            <th>参数名</th>
            <th>类型</th>
            <th>必须</th>
            <th>描述</th>
          </tr>
          <tr>
            <td class="param-name">content</td>
            <td class="param-type">string</td>
            <td class="param-required">是</td>
            <td>需要生成嵌入向量的文本内容</td>
          </tr>
          <tr>
            <td class="param-name">model</td>
            <td class="param-type">string</td>
            <td class="param-optional">否</td>
            <td>指定使用的模型，默认为 text-embedding-3-large</td>
          </tr>
          <tr>
            <td class="param-name">dimensions</td>
            <td class="param-type">number</td>
            <td class="param-optional">否</td>
            <td>指定嵌入向量的维度</td>
          </tr>
        </table>
        
        <h3>生成摘要</h3>
        <div><span class="method post">POST</span><span class="endpoint">/api/gateway/summarize</span></div>
        <p>为长文本生成简洁摘要。</p>
        
        <h4>请求参数</h4>
        <table>
          <tr>
            <th>参数名</th>
            <th>类型</th>
            <th>必须</th>
            <th>描述</th>
          </tr>
          <tr>
            <td class="param-name">content</td>
            <td class="param-type">string</td>
            <td class="param-required">是</td>
            <td>需要摘要的原始文本</td>
          </tr>
          <tr>
            <td class="param-name">model</td>
            <td class="param-type">string</td>
            <td class="param-optional">否</td>
            <td>指定使用的模型</td>
          </tr>
          <tr>
            <td class="param-name">maxLength</td>
            <td class="param-type">number</td>
            <td class="param-optional">否</td>
            <td>摘要的最大长度限制</td>
          </tr>
        </table>
        
        <h3>聊天对话</h3>
        <div><span class="method post">POST</span><span class="endpoint">/api/gateway/chat</span></div>
        <p>与AI模型进行对话交流。</p>
        
        <h4>请求参数</h4>
        <table>
          <tr>
            <th>参数名</th>
            <th>类型</th>
            <th>必须</th>
            <th>描述</th>
          </tr>
          <tr>
            <td class="param-name">messages</td>
            <td class="param-type">array</td>
            <td class="param-required">是</td>
            <td>对话消息数组，每条消息包含 role 和 content</td>
          </tr>
          <tr>
            <td class="param-name">model</td>
            <td class="param-type">string</td>
            <td class="param-optional">否</td>
            <td>指定使用的模型，默认为 gpt-4o</td>
          </tr>
          <tr>
            <td class="param-name">temperature</td>
            <td class="param-type">number</td>
            <td class="param-optional">否</td>
            <td>生成文本的随机性，0-1 之间，较低值使输出更确定性，较高值使输出更多样化</td>
          </tr>
        </table>
        
        <h4>请求示例</h4>
        <div class="response-example">
          <pre><code>{
  "messages": [
    {
      "role": "system",
      "content": "你是一个客服助手，提供简洁准确的回答。"
    },
    {
      "role": "user",
      "content": "如何重置我的账户密码？"
    }
  ],
  "model": "gpt-4o",
  "temperature": 0.3
}</code></pre>
        </div>
        
        <h2>可用模型</h2>
        <p>系统支持以下模型，可以在请求中通过 model 参数指定：</p>
        
        <h3>OpenAI 模型</h3>
        <ul>
          <li><code>gpt-4o</code> - OpenAI 的最新通用模型，适用于大多数任务</li>
          <li><code>gpt-3.5-turbo</code> - 更经济的模型，适合一般任务</li>
          <li><code>text-embedding-3-large</code> - 嵌入向量生成专用模型</li>
        </ul>
        
        <h3>Google 模型</h3>
        <ul>
          <li><code>gemini-2.0-flash</code> - Google 的高效通用模型</li>
          <li><code>gemini-1.5-flash-8b-001</code> - 轻量级模型，适合快速处理</li>
          <li><code>embedding-001</code> - Google 的嵌入向量模型</li>
        </ul>
        
        <h2>错误处理</h2>
        <p>当API请求失败时，将返回包含错误详情的响应：</p>
        <div class="response-example">
          <pre><code>{
  "success": false,
  "error": "错误描述信息",
  "meta": {
    "requestId": "a323353b-57db-47c0-9173-43d30f7b614c",
    "processedAt": "2025-05-23T12:34:56.789Z"
  }
}</code></pre>
        </div>
        
        <h3>常见错误代码</h3>
        <table>
          <tr>
            <th>状态码</th>
            <th>描述</th>
          </tr>
          <tr>
            <td>400</td>
            <td>请求参数无效</td>
          </tr>
          <tr>
            <td>401</td>
            <td>认证失败</td>
          </tr>
          <tr>
            <td>404</td>
            <td>请求的资源不存在</td>
          </tr>
          <tr>
            <td>500</td>
            <td>服务器内部错误</td>
          </tr>
        </table>
        
        <p class="info">
          <strong>注意：</strong> API 访问频率可能受限，请合理控制请求频率，避免触发限流。
        </p>
      </body>
    </html>
  `);
});

// 挂载 API 路由
app.route('/api/models', modelRouter);

// 挂载 Gateway API 路由
app.route('/api/gateway', gatewayRouter);

// 兼容旧路径
app.route('/api', modelRouter);

// Worker 默认处理程序
export default {
  fetch: app.fetch,
};