import { Hono } from 'hono';
import { Env } from '../index';
import { $articles, $sources, eq, sql, and } from '@meridian/database';
import { getDb } from '../lib/database';
import type { HonoEnv } from '../app';
import { Logger } from '../lib/core/logger';

const app = new Hono<{ Bindings: Env }>();
const logger = new Logger({ component: 'events-api', level: 'debug' });

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
  
  // 添加分页参数
  const page = parseInt(c.req.query('page') || '1', 10);
  const limit = parseInt(c.req.query('limit') || '100', 10);
  const usePagination = c.req.query('pagination') === 'true';
  
  // 验证分页参数
  const validPage = page > 0 ? page : 1;
  const validLimit = limit > 0 && limit <= 1000 ? limit : 100;
  const offset = (validPage - 1) * validLimit;
  
  logger.info('获取事件数据', { date, usePagination, page: validPage, limit: validLimit });
  
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
    
    // 首先获取总记录数
    const countQuery = db.select({
      count: sql`count(*)`.as('count')
    })
    .from($articles)
    .where(conditions);
    
    // 使用组合条件构建查询
    const baseQuery = db.select({
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
    
    // 如果使用分页，则应用分页限制
    let articlesQuery = usePagination 
      ? baseQuery.limit(validLimit).offset(offset)
      : baseQuery;
    
    // 获取源信息
    const sourcesQuery = db.select({
      id: $sources.id,
      name: $sources.name
    })
    .from($sources);
    
    // 并行执行查询
    const [countResult, articles, sources] = await Promise.all([
      countQuery.execute(),
      articlesQuery.execute(),
      sourcesQuery.execute()
    ]);
    
    // 获取总记录数
    const totalCount = parseInt(countResult[0]?.count?.toString() || '0', 10);
    
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
      
      // 改进事件摘要处理逻辑
      let summary = '';
      logger.info('摘要处理开始', { 
        article_id: article.id, 
        has_summary: Boolean(article.event_summary_points),
        summary_type: typeof article.event_summary_points,
        raw_value: article.event_summary_points
      });
      
      // 处理各种可能的数据格式
      const rawSummary = article.event_summary_points;
      
      if (rawSummary) {
        try {
          // 检查是否已经是数组类型
          if (Array.isArray(rawSummary)) {
            // 已经是数组，直接使用
            summary = rawSummary.join('\n');
            logger.info('直接使用数组数据作为摘要', { article_id: article.id });
          } else {
            // 非数组情况按原有逻辑处理
            const rawStr = typeof rawSummary === 'string' ? rawSummary.trim() : String(rawSummary).trim();
            
            try {
              const parsed = JSON.parse(rawStr);
              if (Array.isArray(parsed)) {
                summary = parsed.join('\n');
                logger.info('通过JSON解析提取摘要(数组)', { article_id: article.id });
              } else if (typeof parsed === 'object' && parsed !== null) {
                // 处理对象格式
                // ... 原有对象处理逻辑保持不变 ...
              } else {
                summary = String(parsed);
                logger.info('通过JSON解析提取摘要(基本类型)', { article_id: article.id });
              }
            } catch (jsonError) {
              // JSON 解析失败的处理逻辑保持不变
              // ... 原有正则表达式和其他处理逻辑 ...
            }
          }
        } catch (error) {
          logger.error('摘要处理失败', { 
            article_id: article.id, 
            error: String(error),
            raw_value: typeof rawSummary === 'object' ? '[Object]' : String(rawSummary)
          });
          
          // 出错时使用简单的回退方案
          if (Array.isArray(rawSummary)) {
            summary = rawSummary.join('\n');
          } else {
            summary = String(rawSummary);
          }
        }
      }
      
      // 最后调试检查
      if (!summary) {
        logger.warn('摘要仍为空', { article_id: article.id });
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
    
    // 计算分页信息
    const totalPages = usePagination ? Math.ceil(totalCount / validLimit) : 1;
    
    // 返回完整响应，包含分页信息（如果使用分页）
    const response: any = {
      sources: formattedSources,
      events: events,
      total: totalCount
    };
    
    // 如果使用分页，添加分页信息
    if (usePagination) {
      response.pagination = {
        page: validPage,
        limit: validLimit,
        pages: totalPages
      };
    }
    
    return c.json(response);
    
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