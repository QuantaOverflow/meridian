/**
 * 数据库模拟实现 - 在内存中模拟数据库操作
 * 用于测试环境下替代真实的 Hyperdrive 数据库连接
 */

// 全局变量，用于模拟路由参数
declare global {
  var mockRouteParam: string | undefined;
}

export interface MockSource {
  id: number;
  name: string;
  url: string;
  category: string;
  scrape_frequency: number;
  paywall?: boolean;
  lastChecked?: Date | null;
  do_initialized_at?: Date | null;
}

export interface MockArticle {
  id: number;
  title: string;
  url: string;
  status: 'PENDING_FETCH' | 'CONTENT_FETCHED' | 'PROCESSED' | 'SKIPPED_PDF' | 'FETCH_FAILED' | 'RENDER_FAILED' | 'AI_ANALYSIS_FAILED' | 'EMBEDDING_FAILED' | 'R2_UPLOAD_FAILED' | 'SKIPPED_TOO_OLD';
  publishDate?: Date | null;
  processedAt?: Date | null;
  sourceId: number;
  contentFileKey?: string | null;
  embedding?: number[] | null;
  language?: string | null;
  primary_location?: string | null;
  completeness?: 'COMPLETE' | 'PARTIAL_USEFUL' | 'PARTIAL_USELESS' | null;
  content_quality?: 'OK' | 'LOW_QUALITY' | 'JUNK' | null;
  used_browser?: boolean | null;
  event_summary_points?: any | null;
  thematic_keywords?: any | null;
  topic_tags?: any | null;
  key_entities?: any | null;
  content_focus?: any | null;
  failReason?: string | null;
  createdAt?: Date;
}

class MockDatabase {
  private sources: Map<number, MockSource> = new Map();
  private articles: Map<number, MockArticle> = new Map();
  private sourceIdCounter = 1;
  private articleIdCounter = 1;
  private lastUrlQuery: string | null = null; // 跟踪最后查询的URL

  constructor() {
    this.reset();
  }

  reset() {
    this.sources.clear();
    this.articles.clear();
    this.sourceIdCounter = 1;
    this.articleIdCounter = 1;
    this.lastUrlQuery = null;
    
    // 添加一些初始测试数据
    this.addInitialData();
  }

  private addInitialData() {
    // 添加测试用的RSS源
    this.sources.set(1, {
      id: 1,
      name: '纽约时报中文网',
      url: 'https://cn.nytimes.com/rss.html',
      category: 'news',
      scrape_frequency: 60, // 修改为测试期望的值
      paywall: false,
      lastChecked: null,
      do_initialized_at: null
    });

    this.sources.set(2, {
      id: 2,
      name: '英国金融时报',
      url: 'https://www.ft.com/rss/feed',
      category: 'finance',
      scrape_frequency: 60, // 修改为测试期望的值
      paywall: true,
      lastChecked: null,
      do_initialized_at: null
    });

    this.sourceIdCounter = 3;

    // 添加测试文章
    this.articles.set(1, {
      id: 1,
      title: '测试文章标题1',
      url: 'https://example.com/article1',
      status: 'PROCESSED',
      sourceId: 1,
      publishDate: new Date('2025-01-15'),
      processedAt: new Date('2025-01-15'),
      contentFileKey: 'articles/article-1.txt',
      embedding: new Array(384).fill(0.1),
      language: 'zh',
      primary_location: 'US',
      completeness: 'COMPLETE',
      content_quality: 'OK',
      used_browser: false,
      createdAt: new Date('2025-01-15')
    });

    this.articles.set(2, {
      id: 2,
      title: '测试文章标题2',
      url: 'https://example.com/article2',
      status: 'PENDING_FETCH',
      sourceId: 2,
      publishDate: new Date('2025-01-16'),
      language: 'en',
      createdAt: new Date('2025-01-16')
    });

    this.articleIdCounter = 3;
  }

  // Sources 相关方法
  getSources() {
    return Array.from(this.sources.values()).sort((a, b) => a.id - b.id);
  }

  getSourceById(id: number) {
    return this.sources.get(id) || null;
  }

  getSourceByUrl(url: string) {
    return Array.from(this.sources.values()).find(s => s.url === url) || null;
  }

  createSource(data: { name: string; url: string; category?: string; scrape_frequency?: number; paywall?: boolean }) {
    const newSource: MockSource = {
      id: this.sourceIdCounter++,
      name: data.name,
      url: data.url,
      category: data.category || 'general',
      scrape_frequency: data.scrape_frequency || 60,
      paywall: data.paywall || false,
      lastChecked: null,
      do_initialized_at: null
    };

    this.sources.set(newSource.id, newSource);
    return newSource;
  }

  updateSource(id: number, data: Partial<Pick<MockSource, 'name' | 'url' | 'category' | 'scrape_frequency' | 'paywall'>>) {
    const source = this.sources.get(id);
    if (!source) return null;

    // 过滤掉undefined值，避免覆盖原有字段
    const filteredData: any = {};
    Object.keys(data).forEach(key => {
      if (data[key as keyof typeof data] !== undefined) {
        filteredData[key] = data[key as keyof typeof data];
      }
    });

    const updatedSource = {
      ...source,
      ...filteredData
    };

    this.sources.set(id, updatedSource);
    return updatedSource;
  }

  deleteSource(id: number) {
    const source = this.sources.get(id);
    if (!source) return null;

    this.sources.delete(id);
    return source;
  }

  // Articles 相关方法
  getArticles(options: {
    status?: string;
    page?: number;
    limit?: number;
  } = {}) {
    let articles = Array.from(this.articles.values());

    // 状态过滤
    if (options.status) {
      articles = articles.filter(a => a.status === options.status);
    }

    // 排序 (按创建时间倒序)
    articles.sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));

    // 分页
    const page = options.page || 1;
    const limit = options.limit || 10;
    const offset = (page - 1) * limit;
    
    return articles.slice(offset, offset + limit);
  }

  getArticleById(id: number) {
    return this.articles.get(id) || null;
  }

  createArticle(data: {
    title: string;
    url: string;
    sourceId: number;
    publishDate?: Date;
    status?: MockArticle['status'];
  }) {
    const newArticle: MockArticle = {
      id: this.articleIdCounter++,
      title: data.title,
      url: data.url,
      status: data.status || 'PENDING_FETCH',
      sourceId: data.sourceId,
      publishDate: data.publishDate || null,
      createdAt: new Date()
    };

    this.articles.set(newArticle.id, newArticle);
    return newArticle;
  }

  updateArticle(id: number, data: Partial<MockArticle>) {
    const article = this.articles.get(id);
    if (!article) return null;

    const updatedArticle = {
      ...article,
      ...data
    };

    this.articles.set(id, updatedArticle);
    return updatedArticle;
  }

  deleteArticle(id: number) {
    const article = this.articles.get(id);
    if (!article) return null;

    this.articles.delete(id);
    return article;
  }

  // 获取未初始化DO的sources
  getSourcesWithoutDO() {
    return Array.from(this.sources.values()).filter(s => !s.do_initialized_at);
  }

  // 标记DO已初始化
  markSourceDOInitialized(id: number) {
    const source = this.sources.get(id);
    if (!source) return null;

    const updatedSource = {
      ...source,
      do_initialized_at: new Date()
    };

    this.sources.set(id, updatedSource);
    return updatedSource;
  }

  // 设置最后查询的URL（用于模拟条件查询）
  setLastUrlQuery(url: string) {
    this.lastUrlQuery = url;
  }

  getLastUrlQuery() {
    return this.lastUrlQuery;
  }
}

// 创建全局实例
export const mockDb = new MockDatabase();

/**
 * 模拟的数据库查询接口，匹配 Drizzle ORM 的查询模式
 */
export function createMockDbQuery() {
  return {
    // 通用查询方法 - 完整的链式调用支持
    select: (fields?: any) => ({
      from: (table: any) => {
        let currentQuery = {
          table,
          whereConditions: [] as any[],
          orderByClause: null as any,
          limitValue: null as number | null,
          offsetValue: null as number | null
        };

        const queryBuilder = {
          where: (condition: any) => {
            currentQuery.whereConditions.push(condition);
            return {
              orderBy: (order: any) => {
                currentQuery.orderByClause = order;
                return {
                  limit: (limit: number) => {
                    currentQuery.limitValue = limit;
                    return {
                      offset: (offset: number) => {
                        currentQuery.offsetValue = offset;
                        // 返回 Promise，支持 await
                        return executeQuery(currentQuery);
                      }
                    };
                  },
                  // 支持直接 await
                  then: (resolve: any, reject: any) => {
                    executeQuery(currentQuery).then(resolve).catch(reject);
                  }
                };
              },
              limit: (limit: number) => {
                currentQuery.limitValue = limit;
                return {
                  offset: (offset: number) => {
                    currentQuery.offsetValue = offset;
                    return executeQuery(currentQuery);
                  },
                  // 支持直接 await
                  then: (resolve: any, reject: any) => {
                    executeQuery(currentQuery).then(resolve).catch(reject);
                  }
                };
              },
              // 支持直接 await
              then: (resolve: any, reject: any) => {
                executeQuery(currentQuery).then(resolve).catch(reject);
              }
            };
          },
          orderBy: (order: any) => {
            currentQuery.orderByClause = order;
            return {
              limit: (limit: number) => {
                currentQuery.limitValue = limit;
                return {
                  offset: (offset: number) => {
                    currentQuery.offsetValue = offset;
                    return executeQuery(currentQuery);
                  },
                  // 支持直接 await
                  then: (resolve: any, reject: any) => {
                    executeQuery(currentQuery).then(resolve).catch(reject);
                  }
                };
              },
              // 支持直接 await
              then: (resolve: any, reject: any) => {
                executeQuery(currentQuery).then(resolve).catch(reject);
              }
            };
          },
          limit: (limit: number) => {
            currentQuery.limitValue = limit;
            return {
              offset: (offset: number) => {
                currentQuery.offsetValue = offset;
                return executeQuery(currentQuery);
              },
              // 支持直接 await
              then: (resolve: any, reject: any) => {
                executeQuery(currentQuery).then(resolve).catch(reject);
              }
            };
          },
          // 支持直接执行查询（没有额外条件）
          then: (resolve: any, reject: any) => {
            executeQuery(currentQuery).then(resolve).catch(reject);
          }
        };

        return queryBuilder;
        
        function executeQuery(query: any) {
          // 改进的表识别逻辑 - 通过多种方式判断是否是文章查询
          let isArticleQuery = false;
          
          // 调试日志已移除以提高测试输出可读性
          
          // 方法1：检查查询条件中的字段名
          const hasArticleFields = (query.whereConditions || []).some((cond: any) => {
            if (!cond || !cond.field) return false;
            const fieldStr = String(cond.field || '').toLowerCase();
            return fieldStr.includes('status') || fieldStr.includes('content') || 
                   fieldStr.includes('publish') || fieldStr.includes('processed') ||
                   fieldStr.includes('embedding') || fieldStr.includes('article') ||
                   fieldStr.includes('createdat'); // 添加createdat字段检查
          });
          
          // 方法2：检查查询字段选择器
          const hasArticleSelectors = query.table && (
            String(query.table).includes('article') || 
            String(query.table).includes('$articles')
          );
          
          // 方法3：检查全局路由参数提示
          const routeIndicatesArticles = typeof global !== 'undefined' && 
            global.mockRouteParam === 'articles';
          
          isArticleQuery = hasArticleFields || hasArticleSelectors || routeIndicatesArticles;
          
          // 查询类型判断逻辑完成
          
          if (isArticleQuery) {
            // 文章查询
            let results = mockDb.getArticles();
            
            // 改进的过滤条件应用
            if (query.whereConditions && query.whereConditions.length > 0) {
              for (const condition of query.whereConditions) {
                // 直接处理SQL对象（可能是单个eq条件或and条件）
                if (condition && condition.queryChunks && Array.isArray(condition.queryChunks)) {
                  const { fieldName, value } = extractFieldAndValue(condition);
                  if (fieldName && value !== undefined) {
                    applyFilter(fieldName, value);
                  }
                }
                // 处理and操作包装的条件
                else if (condition && condition.operator === 'and' && condition.conditions) {
                  for (const subCondition of condition.conditions) {
                    if (subCondition && subCondition.operator === 'eq') {
                      const { fieldName, value } = extractFieldAndValue(subCondition);
                      applyFilter(fieldName, value);
                    }
                  }
                } else if (condition && condition.operator === 'eq') {
                  const { fieldName, value } = extractFieldAndValue(condition);
                  applyFilter(fieldName, value);
                }
              }
            }
            
            function extractFieldAndValue(condition: any): { fieldName: string; value: any } {
              let fieldName = '';
              let value = undefined;
              
              // 处理Drizzle ORM的SQL条件对象 - 支持递归处理
              if (condition.queryChunks && Array.isArray(condition.queryChunks)) {
                // 查找字段信息和参数值
                for (const chunk of condition.queryChunks) {
                  if (chunk && typeof chunk === 'object') {
                    // 如果chunk本身也是SQL对象，递归处理
                    if (chunk.queryChunks && Array.isArray(chunk.queryChunks)) {
                      const innerResult: { fieldName: string; value: any } = extractFieldAndValue(chunk);
                      if (innerResult.fieldName && innerResult.value !== undefined) {
                        fieldName = innerResult.fieldName;
                        value = innerResult.value;
                        break;
                      }
                    }
                    // 查找字段名
                    else if (chunk.name && typeof chunk.name === 'string') {
                      fieldName = chunk.name.toLowerCase();
                    }
                    // 查找参数值
                    else if (chunk.hasOwnProperty('value') && chunk.hasOwnProperty('encoder')) {
                      value = chunk.value;
                    }
                  }
                }
              }
              
              // 后备方案：使用原有的字段解析逻辑
              if (!fieldName && condition.field) {
                if (typeof condition.field === 'string') {
                  fieldName = condition.field.toLowerCase();
                } else if (condition.field.name) {
                  fieldName = condition.field.name.toLowerCase();
                } else {
                  fieldName = String(condition.field).toLowerCase();
                }
              }
              
              // 后备方案：使用原有的值解析逻辑
              if (value === undefined && condition.value !== undefined) {
                value = condition.value;
              }
              
              return { fieldName, value };
            }
            
            function applyFilter(fieldName: string, value: any) {
              if (fieldName && value !== undefined) {
                if (fieldName.includes('status')) {
                  results = results.filter(article => article.status === value);
                }
                if (fieldName.includes('id')) {
                  results = results.filter(article => article.id === value);
                }
                if (fieldName.includes('sourceid')) {
                  results = results.filter(article => article.sourceId === value);
                }
              }
            }
            
            // 应用分页
            if (query.limitValue && query.offsetValue !== null) {
              results = results.slice(query.offsetValue, query.offsetValue + query.limitValue);
            } else if (query.limitValue) {
              results = results.slice(0, query.limitValue);
            }
            
            return Promise.resolve(results);
          } else {
            // 源查询
            let results = mockDb.getSources();
            
            // 应用过滤条件
            if (query.whereConditions && query.whereConditions.length > 0) {
              for (const condition of query.whereConditions) {
                if (condition && condition.operator === 'eq') {
                  let fieldName = '';
                  let value = undefined;
                  
                  // 处理Drizzle ORM的SQL条件对象
                  if (condition.queryChunks && Array.isArray(condition.queryChunks)) {
                    // 查找字段信息和参数值
                    for (const chunk of condition.queryChunks) {
                      if (chunk && typeof chunk === 'object') {
                        // 查找字段名
                        if (chunk.name && typeof chunk.name === 'string') {
                          fieldName = chunk.name.toLowerCase();
                        }
                        // 查找参数值
                        if (chunk.hasOwnProperty('value') && chunk.hasOwnProperty('encoder')) {
                          value = chunk.value;
                        }
                      }
                    }
                  }
                  
                  // 后备方案：使用原有的字段解析逻辑
                  if (!fieldName && condition.field) {
                    if (typeof condition.field === 'string') {
                      fieldName = condition.field.toLowerCase();
                    } else if (condition.field.name) {
                      fieldName = condition.field.name.toLowerCase();
                    } else {
                      fieldName = String(condition.field).toLowerCase();
                    }
                  }
                  
                  // 后备方案：使用原有的值解析逻辑
                  if (value === undefined && condition.value !== undefined) {
                    value = condition.value;
                  }
                  
                  // 应用过滤条件
                  if (fieldName && value !== undefined) {
                    if (fieldName.includes('url')) {
                      results = results.filter(source => source.url === value);
                    }
                    if (fieldName.includes('id')) {
                      results = results.filter(source => source.id === value);
                    }
                  }
                }
              }
            }
            
            // 应用分页
            if (query.limitValue && query.offsetValue !== null) {
              results = results.slice(query.offsetValue, query.offsetValue + query.limitValue);
            } else if (query.limitValue) {
              results = results.slice(0, query.limitValue);
            }
            
            return Promise.resolve(results);
          }
        }
      }
    }),

    // Insert 操作
    insert: (table: any) => ({
      values: (data: any) => ({
        returning: () => {
          // 检查表类型 - 通过数据结构判断
          const isArticleData = data.hasOwnProperty('title') && data.hasOwnProperty('status');
          
          if (isArticleData) {
            // 文章插入
            return Promise.resolve([mockDb.createArticle(data)]);
          } else {
            // 源插入 - 检查 URL 是否已存在
            if (data.url && mockDb.getSourceByUrl(data.url)) {
              throw new Error('URL already exists');
            }
            return Promise.resolve([mockDb.createSource(data)]);
          }
        }
      })
    }),

    // Update 操作
    update: (table: any) => ({
      set: (data: any) => ({
        where: (condition: any) => ({
          returning: () => {
            // 检查是否是文章更新还是源更新
            const hasArticleFields = Object.keys(data).some(key => 
              ['title', 'status', 'contentFileKey', 'embedding'].includes(key)
            );
            
            // 改进的ID提取逻辑
            let targetId;
            if (condition && typeof condition === 'object') {
              // 处理Drizzle ORM的SQL对象结构
              if (condition.queryChunks && Array.isArray(condition.queryChunks)) {
                // 在queryChunks中查找Param对象
                const paramChunk = condition.queryChunks.find((chunk: any) => 
                  chunk && typeof chunk === 'object' && chunk.hasOwnProperty('value') && chunk.hasOwnProperty('encoder')
                );
                if (paramChunk) {
                  targetId = paramChunk.value;
                }
              }
              // 保留原有的提取逻辑作为后备方案
              else if (condition.value !== undefined) {
                targetId = condition.value;
              } else if (condition.right !== undefined) {
                targetId = condition.right;
              } else if (condition.operator === 'eq' && condition.value !== undefined) {
                targetId = condition.value;
              }
            } else if (typeof condition === 'number') {
              targetId = condition;
            }
            
            // 如果仍然无法提取ID，返回空结果
            if (targetId === undefined) {
              return Promise.resolve([]);
            }
            
            if (hasArticleFields) {
              // 文章更新
              const updated = mockDb.updateArticle(targetId, data);
              return Promise.resolve(updated ? [updated] : []);
            } else {
              // 源更新
              const updated = mockDb.updateSource(targetId, data);
              return Promise.resolve(updated ? [updated] : []);
            }
          }
        })
      })
    }),

    // Delete 操作
    delete: (table: any) => ({
      where: (condition: any) => ({
        returning: () => {
          // 改进的ID提取逻辑
          let targetId;
          if (condition && typeof condition === 'object') {
            // 处理Drizzle ORM的SQL对象结构
            if (condition.queryChunks && Array.isArray(condition.queryChunks)) {
              // 在queryChunks中查找Param对象
              const paramChunk = condition.queryChunks.find((chunk: any) => 
                chunk && typeof chunk === 'object' && chunk.hasOwnProperty('value') && chunk.hasOwnProperty('encoder')
              );
              if (paramChunk) {
                targetId = paramChunk.value;
              }
            }
            // 保留原有的提取逻辑作为后备方案
            else if (condition.value !== undefined) {
              targetId = condition.value;
            } else if (condition.right !== undefined) {
              targetId = condition.right;
            } else if (condition.operator === 'eq' && condition.value !== undefined) {
              targetId = condition.value;
            }
          } else if (typeof condition === 'number') {
            targetId = condition;
          }
          
          // 如果无法提取ID，返回空结果
          if (targetId === undefined) {
            return Promise.resolve([]);
          }
          
          // 通过表引用或上下文判断是否是文章表还是源表
          // 改进：检查全局路由标识来判断操作类型
          const isArticleOperation = typeof global !== 'undefined' && 
            global.mockRouteParam === 'articles';
          
          if (isArticleOperation) {
            // 文章删除 (目前测试中没有这个场景，但为完整性添加)
            const deleted = mockDb.deleteArticle(targetId);
            return Promise.resolve(deleted ? [deleted] : []);
          } else {
            // 源删除
            const deleted = mockDb.deleteSource(targetId);
            return Promise.resolve(deleted ? [deleted] : []);
          }
        }
      })
    }),

    // Query 对象，提供表级别的查询方法
    query: {
      $sources: {
        findFirst: (options: { where: any }) => {
          // 查找匹配条件的源
          const condition = options.where;
          if (condition && condition.operator === 'eq') {
            const fieldStr = String(condition.field || '').toLowerCase();
            if (fieldStr.includes('url')) {
              const existingSource = mockDb.getSourceByUrl(condition.value);
              return Promise.resolve(existingSource || undefined);
            }
            if (fieldStr.includes('id')) {
              const existingSource = mockDb.getSourceById(condition.value);
              return Promise.resolve(existingSource || undefined);
            }
          }
          
          // 其他查询情况 - 返回undefined
          return Promise.resolve(undefined);
        }
      },
      $articles: {
        findFirst: (options: { where: any }) => {
          const condition = options.where;
          if (condition && condition.operator === 'eq') {
            const fieldStr = String(condition.field || '').toLowerCase();
            if (fieldStr.includes('id')) {
              const existingArticle = mockDb.getArticleById(condition.value);
              return Promise.resolve(existingArticle || undefined);
            }
          }
          
          return Promise.resolve(undefined);
        }
      }
    }
  };
}

/**
 * 重置数据库到初始状态
 */
export function resetMockDatabase() {
  mockDb.reset();
}

/**
 * Mock 数据库表符号，用于条件匹配
 */
export const $sources = { 
  name: 'sources',
  id: { name: 'id' },
  url: { name: 'url' },
  category: { name: 'category' }
};
export const $articles = { 
  name: 'articles',
  id: { name: 'id' },
  status: { name: 'status' },
  createdAt: { name: 'createdAt' }
};

/**
 * Mock 条件函数
 */
export const eq = (field: any, value: any) => {
  return { 
    field: field, 
    value: value, 
    operator: 'eq'
  };
};

export const and = (...conditions: any[]) => {
  return { operator: 'and', conditions };
};

export const desc = (field: any) => {
  return { field, direction: 'desc' };
}; 