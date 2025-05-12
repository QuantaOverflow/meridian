import requests
import os
from datetime import date
from pydantic import BaseModel, field_validator
from typing import Optional, List, Dict, Any
import pandas as pd
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, field_validator
from dotenv import load_dotenv
 
load_dotenv()


class Source(BaseModel):
    id: int
    name: str


class Event(BaseModel):
    id: int
    sourceId: int
    url: str
    title: str
    publishDate: datetime  # changed from date to datetime
    content: str
    location: str
    relevance: str
    completeness: str
    summary: str

    @field_validator("publishDate", mode="before")
    @classmethod
    def parse_date(cls, value):
        if value is None:
            return None
            
        # 如果是pandas的Timestamp对象，直接转换为Python datetime
        if hasattr(value, 'to_pydatetime'):
            return value.to_pydatetime()
            
        # 如果是字符串，尝试解析
        if isinstance(value, str):
            # Handle ISO format with timezone info
            try:
                return datetime.fromisoformat(value)
            except ValueError:
                # For older Python versions or non-standard formats
                from dateutil import parser
                return parser.parse(value)
                
        # 如果已经是datetime对象，直接返回
        if isinstance(value, datetime):
            return value
            
        # 其他情况，尝试转换
        try:
            from dateutil import parser
            return parser.parse(str(value))
        except:
            raise ValueError(f"无法解析日期值: {value}, 类型: {type(value)}")



class EventResponse(BaseModel):
    sources: List[Source]
    events: List[Event]
    total: Optional[int] = None


def get_events(date: str = None) -> EventResponse:
    """从远程 API 获取事件数据"""
    url = f"https://meridian-backend.swj299792458.workers.dev/events"
    
    params = {}
    if date:
        params["date"] = date
    
    response = requests.get( 
        url,
        params=params,
        headers={"Authorization": f"Bearer {os.environ.get('MERIDIAN_SECRET_KEY')}"},
    )
    data = response.json()

    # 转换数据为标准格式
    sources = [Source(**source) for source in data["sources"]]
    events = [Event(**event) for event in data["events"]]
    
    return EventResponse(
        sources=sources,
        events=events,
        total=len(events)
    )


def get_events_with_pagination(date: str = None, page_size: int = 100) -> EventResponse:
    """
    通过分页方式从API获取所有事件数据
    
    参数:
        date: 可选的日期过滤 (YYYY-MM-DD)
        page_size: 每页获取的记录数量
        
    返回:
        EventResponse 对象，包含所有页面的数据合并结果
    """
    url = f"https://meridian-backend.swj299792458.workers.dev/events"
    
    # 初始化结果集
    all_events = []
    all_sources = []
    current_page = 1
    total_events = 0
    
    while True:
        # 设置请求参数，包括分页参数 - 修正参数名称
        params = {
            "page": current_page,
            "limit": page_size,
            "pagination": "true"  # 显式启用分页
        }
        if date:
            params["date"] = date
        
        print(f"正在获取第{current_page}页数据 (每页{page_size}条)...")
        
        # 发送请求，添加重试和错误处理机制
        max_retries = 3
        retry_count = 0
        
        while retry_count < max_retries:
            try:
                response = requests.get(
                    url,
                    params=params,
                    headers={"Authorization": f"Bearer {os.environ.get('MERIDIAN_SECRET_KEY')}"},
                    timeout=30  # 添加超时设置
                )
                response.raise_for_status()  # 检查HTTP错误
                data = response.json()
                break  # 成功获取数据，跳出重试循环
            except Exception as e:
                retry_count += 1
                if retry_count >= max_retries:
                    print(f"获取第{current_page}页数据失败: {str(e)}")
                    # 如果已经获取了一些数据，可以继续处理
                    if all_events:
                        print(f"将使用已获取的{len(all_events)}条记录")
                        break
                    else:
                        raise Exception(f"无法获取任何数据: {str(e)}")
                print(f"请求失败，第{retry_count}次重试...")
                import time
                time.sleep(1)  # 重试前等待1秒
                
        # 如果重试最终失败，且没有获取到数据，跳出主循环
        if retry_count >= max_retries and not all_events:
            break
        
        # 提取当前页数据
        page_events = data.get("events", [])
        page_sources = data.get("sources", [])
        total_count = data.get("total", 0)  # 总记录数
        
        # 获取分页信息
        pagination = data.get("pagination", {})
        current_page_from_response = pagination.get("page", current_page)
        total_pages = pagination.get("pages", 1)
        
        print(f"获取到{len(page_events)}条记录，总记录数:{total_count}, 当前页:{current_page_from_response}, 总页数:{total_pages}")
        
        # 将页面数据添加到结果集，同时避免重复
        event_ids = {e["id"] for e in all_events}
        for event in page_events:
            if event["id"] not in event_ids:
                all_events.append(event)
                event_ids.add(event["id"])
            else:
                print(f"警告: 发现重复事件ID: {event['id']}")
        
        # 只添加新的source，避免重复
        source_ids = {s["id"] for s in all_sources}
        for source in page_sources:
            if source["id"] not in source_ids:
                all_sources.append(source)
                source_ids.add(source["id"])
        
        # 判断是否有下一页 - 使用更可靠的方法
        if current_page_from_response >= total_pages:
            print(f"已到达最后一页 ({current_page_from_response}/{total_pages})")
            break
            
        # 检查获取的数据量是否达到总量
        if len(all_events) >= total_count:
            print(f"已获取所有数据: {len(all_events)}/{total_count}")
            break
            
        # 继续获取下一页
        current_page += 1
    
    print(f"分页爬取完成，共获取{len(all_events)}条记录，去重后{len(set(e['id'] for e in all_events))}条")
    
    # 转换数据为标准格式
    sources = [Source(**source) for source in all_sources]
    events = [Event(**event) for event in all_events]
    
    return EventResponse(
        sources=sources,
        events=events,
        total=len(events)
    )


# 本地数据库获取函数
def get_events_local(date: str = None) -> EventResponse:
    """从本地数据库获取文章数据，获取所有匹配的数据"""
    from sqlalchemy import create_engine, text
    
    db_url = os.environ.get('DATABASE_URL', 'postgresql://postgres:709323@localhost:5432/shiwenjie')
    engine = create_engine(db_url)
    
    with engine.connect() as conn:
        # 构建查询条件
        where_clause = ""
        if date:
            where_clause = f"WHERE DATE(a.publish_date) = '{date}'"
            
        # 查询文章 - 不使用分页，获取所有数据
        query = text(f"""
            SELECT a.*, s.name as source_name 
            FROM articles a 
            JOIN sources s ON a.source_id = s.id 
            {where_clause}
            ORDER BY a.publish_date DESC
        """)
        
        articles_df = pd.read_sql(query, conn)
        
        # 获取源
        sources_query = text("SELECT * FROM sources")
        sources_df = pd.read_sql(sources_query, conn)
    
    # 转换源数据为 Source 对象
    sources = []
    for _, row in sources_df.iterrows():
        source_dict = {
            "id": int(row['id']),
            "name": row['name']
        }
        sources.append(Source(**source_dict))
    
    # 转换文章数据为 Event 对象
    events = []
    for _, row in articles_df.iterrows():
        try:
            # 显式转换 publish_date 为 Python datetime
            publish_date = None
            if pd.notna(row['publish_date']):
                if hasattr(row['publish_date'], 'to_pydatetime'):
                    publish_date = row['publish_date'].to_pydatetime()
                else:
                    # 如果不是 Timestamp 但有值，尝试转换
                    from dateutil import parser
                    try:
                        publish_date = parser.parse(str(row['publish_date']))
                    except:
                        print(f"警告: 无法解析日期 {row['publish_date']}, 使用当前时间")
                        publish_date = datetime.now()
                        
            # 处理相关性字段
            relevance = 'medium'
            if 'content_quality' in row and pd.notna(row['content_quality']):
                if row['content_quality'] == 'OK':
                    relevance = 'high'
                elif row['content_quality'] == 'LOW_QUALITY':
                    relevance = 'low'
            
            # 基本必填字段 - 注意字段名映射
            event_dict = {
                "id": int(row['id']),
                "sourceId": int(row['source_id']) if 'source_id' in row else None,
                "url": row['url'],
                "title": row['title'],
                "publishDate": publish_date,
                "content": row['content'] if 'content' in row and pd.notna(row['content']) else "",
                "location": row['primary_location'] if 'primary_location' in row and pd.notna(row['primary_location']) else "",
                "relevance": relevance,
                "completeness": str(row['completeness']).lower() if 'completeness' in row and pd.notna(row['completeness']) else "unknown",
                "summary": ""
            }
            
            # 处理摘要 - 尝试解析 event_summary_points
            if 'event_summary_points' in row and pd.notna(row['event_summary_points']):
                try:
                    import json
                    summary_points = json.loads(row['event_summary_points'])
                    if isinstance(summary_points, list):
                        event_dict["summary"] = "\n".join(summary_points)
                    else:
                        event_dict["summary"] = str(summary_points)
                except:
                    event_dict["summary"] = str(row['event_summary_points'])
            
            events.append(Event(**event_dict))
        except Exception as e:
            print(f"创建事件对象时出错: {e}")
            print(f"问题数据行: {row.to_dict()}")
            continue
    
    # 创建并返回标准格式的响应
    return EventResponse(
        sources=sources,
        events=events,
        total=len(events)
    )


# 添加统一的获取接口，自动选择本地或远程数据源
def fetch_events(date: str = None, use_local: bool = False) -> EventResponse:
    """
    统一的事件获取接口，可选择从本地或远程获取数据
    
    参数:
        date: 可选的日期过滤 (YYYY-MM-DD)
        use_local: 是否使用本地数据库, 默认为False
    
    返回:
        EventResponse 对象，包含源列表、事件列表
    """
    if use_local:
        return get_events_local(date)
    else:
        return get_events(date)


# 添加以下调试函数
def debug_database_connection():
    """调试数据库连接和表结构"""
    from sqlalchemy import create_engine, text
    import pandas as pd
    
    print("\n==== 开始数据库调试 ====")
    
    # 1. 测试数据库连接
    db_url = os.environ.get('DATABASE_URL', 'postgresql://postgres:709323@localhost:5432/shiwenjie')
    print(f"使用数据库连接: {db_url}")
    
    try:
        engine = create_engine(db_url)
        with engine.connect() as conn:
            # 简单查询验证连接
            result = conn.execute(text("SELECT 1")).fetchone()
            print(f"数据库连接测试: 成功 {result}")
            
            # 2. 检查表是否存在
            tables_query = text("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
            tables = [table[0] for table in conn.execute(tables_query).fetchall()]
            print(f"数据库中的表: {tables}")
            
            # 3. 检查articles表结构
            if 'articles' in tables:
                columns_query = text("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'articles'")
                columns = [col[0] for col in conn.execute(columns_query).fetchall()]
                print(f"articles表的字段: {columns}")
                
                # 4. 检查articles表中的记录数
                count_query = text("SELECT COUNT(*) FROM articles")
                count = conn.execute(count_query).fetchone()[0]
                print(f"articles表中的记录数: {count}")
                
                # 如果有记录，显示一条示例
                if count > 0:
                    sample_query = text("SELECT * FROM articles LIMIT 1")
                    sample = conn.execute(sample_query).fetchone()
                    print(f"articles表中的示例记录: {sample}")
            else:
                print("警告: articles表不存在")
                
            # 5. 检查sources表结构
            if 'sources' in tables:
                columns_query = text("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sources'")
                columns = [col[0] for col in conn.execute(columns_query).fetchall()]
                print(f"sources表的字段: {columns}")
                
                # 检查sources表中的记录数
                count_query = text("SELECT COUNT(*) FROM sources")
                count = conn.execute(count_query).fetchone()[0]
                print(f"sources表中的记录数: {count}")
            else:
                print("警告: sources表不存在")
                
            # 6. 检查JOIN操作
            if 'articles' in tables and 'sources' in tables:
                try:
                    join_query = text("SELECT COUNT(*) FROM articles a JOIN sources s ON a.source_id = s.id")
                    join_count = conn.execute(join_query).fetchone()[0]
                    print(f"JOIN后的记录数: {join_count}")
                    
                    # 如果JOIN后没有记录，检查外键关系
                    if join_count == 0:
                        # 检查articles表中的source_id值
                        source_id_query = text("SELECT DISTINCT source_id FROM articles")
                        source_ids = [sid[0] for sid in conn.execute(source_id_query).fetchall() if sid[0] is not None]
                        print(f"articles表中的source_id值: {source_ids}")
                        
                        # 检查sources表中的id值
                        id_query = text("SELECT DISTINCT id FROM sources")
                        ids = [id_[0] for id_ in conn.execute(id_query).fetchall()]
                        print(f"sources表中的id值: {ids}")
                        
                        # 检查交集
                        intersection = set(source_ids).intersection(set(ids))
                        print(f"source_id和id的交集: {intersection}")
                except Exception as e:
                    print(f"JOIN查询失败: {e}")
    except Exception as e:
        print(f"数据库连接或查询失败: {e}")
    
    print("==== 数据库调试结束 ====\n")

# 如果直接运行这个文件，执行调试
if __name__ == "__main__":
    debug_database_connection()
    
    # 测试统一接口
    print("\n==== 测试 fetch_events 函数 ====")
    response = fetch_events(use_local=True)
    print(f"获取的事件数: {len(response.events)}")
    print(f"获取的源数: {len(response.sources)}")
    print(f"总记录数: {response.total}")
    
    # 如果有事件，打印第一个事件的详细信息
    if response.events:
        print("\n第一个事件的详细信息:")
        event = response.events[0]
        for field_name, field_value in event.model_dump().items():
            print(f"  {field_name}: {field_value}")
    else:
        print("\n没有获取到任何事件，请检查数据库或查询条件")
    
    print("==== 测试结束 ====")