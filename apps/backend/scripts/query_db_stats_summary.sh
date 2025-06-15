#!/bin/bash

DB_CONN_STR="postgresql://postgres:709323@localhost:5432/shiwenjie"

echo "=== Meridian 数据库统计概览 ==="
echo "统计时间: $(date)"
echo ""

# --- 核心指标概览 ---
echo "【核心指标】"
psql "$DB_CONN_STR" -c "
  SELECT 
    'RSS源数量' as 指标, 
    COUNT(*)::text as 数值 
  FROM sources
  
  UNION ALL
  
  SELECT 
    '文章总数' as 指标, 
    COUNT(*)::text as 数值 
  FROM articles
  
  UNION ALL
  
  SELECT 
    '已处理文章' as 指标, 
    COUNT(*)::text as 数值 
  FROM articles 
  WHERE status = 'PROCESSED'
  
  UNION ALL
  
  SELECT 
    '简报总数' as 指标, 
    COUNT(*)::text as 数值 
  FROM reports
  
  UNION ALL
  
  SELECT 
    'Newsletter订阅' as 指标, 
    COUNT(*)::text as 数值 
  FROM newsletter;
"

echo ""
echo "【处理效率】"
psql "$DB_CONN_STR" -c "
  WITH stats AS (
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN status = 'PROCESSED' THEN 1 END) as processed,
      COUNT(CASE WHEN status::text LIKE '%FAILED' THEN 1 END) as failed
    FROM articles
  )
  SELECT 
    ROUND(processed * 100.0 / total, 1) || '%' as 成功率,
    ROUND(failed * 100.0 / total, 1) || '%' as 失败率,
    processed || '/' || total as 处理进度
  FROM stats;
"

echo ""
echo "【最近活动 - 7天内】"
psql "$DB_CONN_STR" -c "
  SELECT 
    '新增文章' as 活动,
    COUNT(*) as 数量,
    '篇' as 单位
  FROM articles 
  WHERE created_at >= NOW() - INTERVAL '7 days'
  
  UNION ALL
  
  SELECT 
    '处理完成' as 活动,
    COUNT(*) as 数量,
    '篇' as 单位
  FROM articles 
  WHERE processed_at >= NOW() - INTERVAL '7 days'
  
  UNION ALL
  
  SELECT 
    '生成简报' as 活动,
    COUNT(*) as 数量,
    '个' as 单位
  FROM reports 
  WHERE created_at >= NOW() - INTERVAL '7 days';
"

echo ""
echo "【文章状态分布】"
psql "$DB_CONN_STR" -c "
  SELECT 
    CASE 
      WHEN status = 'PROCESSED' THEN '✅ 已处理'
      WHEN status = 'PENDING_FETCH' THEN '⏳ 待抓取'
      WHEN status = 'SKIPPED_TOO_OLD' THEN '⏭️ 跳过(太旧)'
      WHEN status::text LIKE '%FAILED' THEN '❌ 处理失败'
      ELSE '❓ 其他'
    END as 状态,
    COUNT(*) as 数量,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) || '%' as 占比
  FROM articles 
  GROUP BY status 
  ORDER BY COUNT(*) DESC;
"

echo ""
echo "【RSS源状态】"
psql "$DB_CONN_STR" -c "
  SELECT 
    s.name as RSS源,
    s.category as 分类,
    COUNT(a.id) as 文章数,
    COUNT(CASE WHEN a.status = 'PROCESSED' THEN 1 END) as 已处理,
    CASE 
      WHEN s.last_checked IS NULL THEN '❌ 未检查'
      WHEN s.last_checked < NOW() - INTERVAL '1 day' THEN '⚠️ 超过1天'
      WHEN s.last_checked < NOW() - INTERVAL '6 hours' THEN '⚠️ 超过6小时'
      ELSE '✅ 最近'
    END as 检查状态
  FROM sources s
  LEFT JOIN articles a ON s.id = a.source_id
  GROUP BY s.id, s.name, s.category, s.last_checked
  ORDER BY COUNT(a.id) DESC;
"

echo ""
echo "【最新简报】(最近5个)"
psql "$DB_CONN_STR" -c "
  SELECT 
    LEFT(title, 50) || '...' as 简报标题,
    used_articles as 使用文章,
    TO_CHAR(created_at, 'MM-DD HH24:MI') as 创建时间
  FROM reports 
  ORDER BY created_at DESC
  LIMIT 5;
"

echo ""
echo "【问题诊断】"
# 检查最常见的失败原因
psql "$DB_CONN_STR" -c "
  SELECT 
    '失败文章数' as 问题类型,
    COUNT(*) as 数量,
    CASE 
      WHEN COUNT(*) = 0 THEN '✅ 无问题'
      WHEN COUNT(*) < 10 THEN '⚠️ 轻微'
      ELSE '❌ 需要关注'
    END as 严重程度
  FROM articles 
  WHERE status::text LIKE '%FAILED'
  
  UNION ALL
  
  SELECT 
    '长时间未检查的RSS源' as 问题类型,
    COUNT(*) as 数量,
    CASE 
      WHEN COUNT(*) = 0 THEN '✅ 无问题'
      WHEN COUNT(*) < 2 THEN '⚠️ 轻微'
      ELSE '❌ 需要关注'
    END as 严重程度
  FROM sources 
  WHERE last_checked < NOW() - INTERVAL '2 days' OR last_checked IS NULL;
"

echo ""
echo "=== 统计完成 ===" 
echo "生成时间: $(date)" 