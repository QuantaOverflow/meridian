import { Hono } from 'hono';
import { logger } from './middleware/logger';
import { auth } from './middleware/auth';
import { modelRouter } from './router/modelRouter';
import { gatewayRouter } from './router/gatewayRouter';
import { errorHandler } from './utils/errorHandler';
import { Env } from './types';

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
        <title>Meridian AI Worker API</title>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
          h1 { color: #333; }
          code { background: #f4f4f4; padding: 2px 4px; border-radius: 3px; }
        </style>
      </head>
      <body>
        <h1>Meridian AI Worker API</h1>
        <p>统一的 AI 服务接口，支持多种模型和任务类型</p>
        
        <h2>可用端点</h2>
        <ul>
          <li><code>GET /</code> - 健康检查</li>
          <li><code>GET /docs</code> - API 文档</li>
          <li><code>GET /api/models</code> - 获取可用模型信息</li>
          <li><code>GET /api/health</code> - 简单健康检查</li>
          <li><code>GET /api/status</code> - 系统详细状态</li>
          <li><code>POST /api/analyze</code> - 文章分析</li>
          <li><code>POST /api/embedding</code> - 生成嵌入向量</li>
          <li><code>POST /api/summarize</code> - 生成摘要</li>
          <li><code>POST /api/chat</code> - 对话聊天</li>
          <li><strong>AI Gateway 测试 API</strong></li>
          <li><code>GET /api/gateway/health</code> - Gateway 健康检查</li>
          <li><code>POST /api/gateway/analyze-article</code> - 使用 Gateway 分析文章</li>
          <li><code>POST /api/gateway/summarize</code> - 使用 Gateway 生成摘要</li>
        </ul>
        
        <p>所有 API 请求需要使用 <code>Authorization: Bearer API_AUTH_KEY</code> 进行身份验证</p>
      </body>
    </html>
  `);
});

// 挂载 API 路由
app.route('/api', modelRouter);

// 挂载 Gateway API 路由
app.route('/api/gateway', gatewayRouter);

// Worker 默认处理程序
export default {
  fetch: app.fetch,
};