import { Hono } from 'hono';
import { Env } from '../index';
import { $articles, $sources, eq, sql, and } from '@meridian/database';
import { getDb } from '../lib/utils';
import type { HonoEnv } from '../app';
import { Logger } from '../lib/logger';

const app = new Hono<{ Bindings: Env }>();
const logger = new Logger({ component: 'events-api' });

// 添加认证中间件
app.use('*', async (c, next) => {
  const authHeader = c.req.header('Authorization');
  const expectedToken = `Bearer ${c.env.API_TOKEN}`;
  
  if (authHeader !== expectedToken) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  return next();
});

// 主要事件获取端点 - 这里修改路径
const route = new Hono<HonoEnv>()
 .get('/', async (c) => {
  const date = c.req.query('date');
  
  logger.info('获取事件数据', { date });
  
  try {
    const db = getDb(c.env.HYPERDRIVE);
    
    // 定义基本条件
    let conditions = eq($articles.status, 'PROCESSED');
    
    // 如果提供了日期参数，添加日期筛选
    if (date) {
      conditions = and(
        conditions,
        sql`DATE(${$articles.publishDate}) = ${date}`
      ) as any;
    }
    
    // 使用组合条件构建查询 - 不再使用分页
    let articlesQuery = db.select({
      id: $articles.id,
      title: $articles.title,
      url: $articles.url,
      source_id: $articles.sourceId,
      publish_date: $articles.publishDate,
      content_file_key: $articles.contentFileKey,
      primary_location: $articles.primary_location,
      completeness: $articles.completeness,
      content_quality: $articles.content_quality,
      event_summary_points: $articles.event_summary_points
    })
    .from($articles)
    .where(conditions)
    .orderBy(sql`${$articles.publishDate} DESC`);
    
    // 获取源信息
    const sourcesQuery = db.select({
      id: $sources.id,
      name: $sources.name
    })
    .from($sources);
    
    // 并行执行查询
    const [articles, sources] = await Promise.all([
      articlesQuery.execute(),
      sourcesQuery.execute()
    ]);
    
    // 转换为客户端所需的响应格式
    const events = await Promise.all(articles.map(async (article) => {
      // 处理 content - 从 R2 获取原始内容
      let content = '';
      if (article.content_file_key) {
        try {
          const obj = await c.env.ARTICLES_BUCKET.get(article.content_file_key);
          if (obj) {
            content = await obj.text();
          }
        } catch (error) {
          logger.error('获取文章内容失败', { 
            article_id: article.id, 
            key: article.content_file_key,
            error: String(error)
          });
          content = `[内容加载失败: ${article.content_file_key}]`;
        }
      }
      
      // 处理事件摘要
      let summary = '';
      if (article.event_summary_points && typeof article.event_summary_points === 'string') {
        try {
          const points = JSON.parse(article.event_summary_points);
          if (Array.isArray(points)) {
            summary = points.join('\n');
          } else {
            summary = String(points);
          }
        } catch (error) {
          summary = String(article.event_summary_points);
        }
      }
      
      // 派生相关性评分
      let relevance = 'medium';
    
      // 确认正确的枚举值
      if (article.content_quality === 'OK') {
        relevance = 'high';
      } else if (article.content_quality === 'LOW_QUALITY') {
        relevance = 'low';
      }
      
      // 处理日期格式
      const publishDate = article.publish_date 
        ? new Date(article.publish_date).toISOString()
        : new Date().toISOString();
      
      // 返回格式化的事件对象
      return {
        id: article.id,
        sourceId: article.source_id,
        url: article.url,
        title: article.title,
        publishDate: publishDate,
        content: content,
        location: article.primary_location || 'N/A',
        relevance: relevance,
        completeness: String(article.completeness).toLowerCase() || 'unknown',
        summary: summary
      };
    }));
    
    // 格式化源数据
    const formattedSources = sources.map(source => ({
      id: source.id,
      name: source.name || `Source ${source.id}`
    }));
    
    // 返回完整响应，只包含数据和总数
    return c.json({
      sources: formattedSources,
      events: events,
      total: events.length
    });
    
  } catch (error) {
    logger.error('获取事件数据失败', { 
      error: String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    
    return c.json({ 
      error: '获取事件数据失败',
      message: String(error)
    }, 500);
  }
});

export default route;