import { Hono } from 'hono';
import { $articles, eq, sql, and } from '@meridian/database';
import { getDb } from '../lib/database';
import type { HonoEnv } from '../app';
import { Logger } from '../lib/core/logger';

const logger = new Logger({ component: 'events-api' });

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
    })
    .from($articles)
    .where(conditions)
    .orderBy(sql`${$articles.publishDate} DESC`);
    
    // 如果使用分页，则应用分页限制
    let articlesQuery = usePagination 
      ? baseQuery.limit(validLimit).offset(offset)
      : baseQuery;
    
    // 并行执行查询
    const [countResult, articles] = await Promise.all([
      countQuery.execute(),
      articlesQuery.execute(),
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
            error_message: String(error)
          });
          content = `[内容加载失败: ${article.content_file_key}]`;
        }
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
      };
    }));
    
    // 计算分页信息
    const totalPages = usePagination ? Math.ceil(totalCount / validLimit) : 1;
    
    // 返回完整响应，包含分页信息（如果使用分页）
    const response: any = {
      events: events,
    };
    
    // 如果使用分页，添加分页信息
    if (usePagination) {
      response.pagination = {
        pages: totalPages
      };
    }
    
    return c.json(response);
    
  } catch (error) {
    logger.error('获取事件数据失败', { 
      error_message: String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    
    return c.json({ 
      error: '获取事件数据失败',
      message: String(error)
    }, 500);
  }
});

export default route;