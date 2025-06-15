#!/bin/bash

DB_CONN_STR="postgresql://postgres:709323@localhost:5432/shiwenjie"

echo "=== Meridian 数据库数据统计 ==="
echo "连接到数据库: $DB_CONN_STR"
echo "统计时间: $(date)"
echo ""

# --- sources 表 ---
echo "--- sources 表统计 ---"
echo "总数:"
psql "$DB_CONN_STR" -c "SELECT COUNT(*) as 总数 FROM sources;"
if [ $? -ne 0 ]; then echo "错误: 无法查询 sources 表."; fi

echo ""
echo "按类别分布:"
psql "$DB_CONN_STR" -c "SELECT category as 类别, COUNT(*) as 数量 FROM sources GROUP BY category ORDER BY COUNT(*) DESC;"

echo ""
echo "按抓取频率分布:"
psql "$DB_CONN_STR" -c "
  SELECT 
    CASE 
      WHEN scrape_frequency = 1 THEN '每小时'
      WHEN scrape_frequency = 2 THEN '4小时'
      WHEN scrape_frequency = 3 THEN '6小时'
      WHEN scrape_frequency = 4 THEN '每日'
      ELSE '其他'
    END as 抓取频率,
    COUNT(*) as 数量
  FROM sources 
  GROUP BY scrape_frequency 
  ORDER BY scrape_frequency;
"

echo ""
echo "是否付费墙分布:"
psql "$DB_CONN_STR" -c "
  SELECT 
    CASE WHEN paywall THEN '付费墙' ELSE '免费' END as 类型,
    COUNT(*) as 数量
  FROM sources 
  GROUP BY paywall;
"

echo ""
echo "最近检查状态 (最新10个):"
psql "$DB_CONN_STR" -c "
  SELECT 
    name as 名称,
    category as 类别,
    last_checked as 最后检查时间,
    CASE 
      WHEN last_checked IS NULL THEN '从未检查'
      WHEN last_checked < NOW() - INTERVAL '1 day' THEN '超过1天'
      WHEN last_checked < NOW() - INTERVAL '6 hours' THEN '超过6小时'
      WHEN last_checked < NOW() - INTERVAL '1 hour' THEN '超过1小时'
      ELSE '最近'
    END as 状态
  FROM sources 
  ORDER BY last_checked DESC NULLS LAST
  LIMIT 10;
"

echo ""
echo "=================================================="

# --- articles 表 ---
echo "--- articles 表统计 ---"
echo "总数:"
psql "$DB_CONN_STR" -c "SELECT COUNT(*) as 总数 FROM articles;"
if [ $? -ne 0 ]; then echo "错误: 无法查询 articles 表总数."; fi

echo ""
echo "状态统计:"
psql "$DB_CONN_STR" -c "
  SELECT 
    status as 状态,
    COUNT(*) as 数量,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) || '%' as 百分比
  FROM articles 
  GROUP BY status 
  ORDER BY COUNT(*) DESC;
"

echo ""
echo "按日期分布 (最近30天):"
psql "$DB_CONN_STR" -c "
  SELECT 
    DATE(created_at) as 日期,
    COUNT(*) as 文章数量
  FROM articles 
  WHERE created_at >= NOW() - INTERVAL '30 days'
  GROUP BY DATE(created_at)
  ORDER BY DATE(created_at) DESC
  LIMIT 15;
"

echo ""
echo "语言分布:"
psql "$DB_CONN_STR" -c "
  SELECT 
    COALESCE(language, '未识别') as 语言,
    COUNT(*) as 数量
  FROM articles 
  GROUP BY language 
  ORDER BY COUNT(*) DESC;
"

echo ""
echo "内容质量分布:"
psql "$DB_CONN_STR" -c "
  SELECT 
    COALESCE(content_quality::text, '未评估') as 内容质量,
    COUNT(*) as 数量
  FROM articles 
  GROUP BY content_quality 
  ORDER BY COUNT(*) DESC;
"

echo ""
echo "完整性分布:"
psql "$DB_CONN_STR" -c "
  SELECT 
    COALESCE(completeness::text, '未评估') as 完整性,
    COUNT(*) as 数量
  FROM articles 
  GROUP BY completeness 
  ORDER BY COUNT(*) DESC;
"

echo ""
echo "按来源统计 (前10):"
psql "$DB_CONN_STR" -c "
  SELECT 
    s.name as 来源名称,
    s.category as 类别,
    COUNT(a.id) as 文章数量,
    COUNT(CASE WHEN a.status = 'PROCESSED' THEN 1 END) as 已处理数量
  FROM sources s
  LEFT JOIN articles a ON s.id = a.source_id
  GROUP BY s.id, s.name, s.category
  ORDER BY COUNT(a.id) DESC
  LIMIT 10;
"

echo ""
echo "处理失败的文章 (最近10个):"
psql "$DB_CONN_STR" -c "
  SELECT 
    title as 标题,
    status as 状态,
    fail_reason as 失败原因,
    created_at as 创建时间
  FROM articles 
  WHERE status::text LIKE '%FAILED'
  ORDER BY created_at DESC
  LIMIT 10;
"

echo ""
echo "最新处理成功的文章 (最近10个):"
psql "$DB_CONN_STR" -c "
  SELECT 
    title as 标题,
    language as 语言,
    primary_location as 主要地点,
    processed_at as 处理时间
  FROM articles 
  WHERE status = 'PROCESSED'
  ORDER BY processed_at DESC
  LIMIT 10;
"

echo ""
echo "=================================================="

# --- reports 表 ---
echo "--- reports 表统计 ---"
echo "总数:"
psql "$DB_CONN_STR" -c "SELECT COUNT(*) as 总数 FROM reports;"
if [ $? -ne 0 ]; then echo "错误: 无法查询 reports 表."; fi

echo ""
echo "简报统计概览:"
psql "$DB_CONN_STR" -c "
  SELECT 
    COUNT(*) as 简报总数,
    AVG(total_articles) as 平均文章数,
    AVG(used_articles) as 平均使用文章数,
    AVG(total_sources) as 平均来源数,
    AVG(used_sources) as 平均使用来源数
  FROM reports;
"

echo ""
echo "最新简报 (最近5个):"
psql "$DB_CONN_STR" -c "
  SELECT 
    title as 标题,
    total_articles as 总文章数,
    used_articles as 使用文章数,
    total_sources as 总来源数,
    used_sources as 使用来源数,
    created_at as 创建时间
  FROM reports 
  ORDER BY created_at DESC
  LIMIT 5;
"

echo ""
echo "按月份分布:"
psql "$DB_CONN_STR" -c "
  SELECT 
    DATE_TRUNC('month', created_at) as 月份,
    COUNT(*) as 简报数量
  FROM reports 
  GROUP BY DATE_TRUNC('month', created_at)
  ORDER BY 月份 DESC;
"

echo ""
echo "=================================================="

# --- newsletter 表 ---
echo "--- newsletter 表统计 ---"
echo "总数:"
psql "$DB_CONN_STR" -c "SELECT COUNT(*) as 订阅总数 FROM newsletter;"
if [ $? -ne 0 ]; then echo "错误: 无法查询 newsletter 表."; fi

echo ""
echo "按注册时间分布 (最近30天):"
psql "$DB_CONN_STR" -c "
  SELECT 
    DATE(created_at) as 注册日期,
    COUNT(*) as 新增订阅数
  FROM newsletter 
  WHERE created_at >= NOW() - INTERVAL '30 days'
  GROUP BY DATE(created_at)
  ORDER BY 注册日期 DESC;
"

echo ""
echo "=================================================="

# --- 总体系统健康状态 ---
echo "--- 系统健康状态总览 ---"
echo ""
echo "数据处理效率统计:"
psql "$DB_CONN_STR" -c "
  WITH stats AS (
    SELECT 
      COUNT(*) as total_articles,
      COUNT(CASE WHEN status = 'PROCESSED' THEN 1 END) as processed_articles,
      COUNT(CASE WHEN status::text LIKE '%FAILED' THEN 1 END) as failed_articles,
      COUNT(CASE WHEN status = 'PENDING_FETCH' THEN 1 END) as pending_articles
    FROM articles
  )
  SELECT 
    total_articles as 文章总数,
    processed_articles as 已处理,
    failed_articles as 失败,
    pending_articles as 待处理,
    ROUND(processed_articles * 100.0 / total_articles, 2) || '%' as 处理成功率,
    ROUND(failed_articles * 100.0 / total_articles, 2) || '%' as 失败率
  FROM stats;
"

echo ""
echo "最近活动状态 (24小时内):"
psql "$DB_CONN_STR" -c "
  SELECT 
    '新增文章' as 活动类型,
    COUNT(*) as 数量
  FROM articles 
  WHERE created_at >= NOW() - INTERVAL '24 hours'
  
  UNION ALL
  
  SELECT 
    '处理完成' as 活动类型,
    COUNT(*) as 数量
  FROM articles 
  WHERE processed_at >= NOW() - INTERVAL '24 hours'
  
  UNION ALL
  
  SELECT 
    '生成简报' as 活动类型,
    COUNT(*) as 数量
  FROM reports 
  WHERE created_at >= NOW() - INTERVAL '24 hours';
"

echo ""
echo "=== 统计完成 ==="
echo "生成时间: $(date)"