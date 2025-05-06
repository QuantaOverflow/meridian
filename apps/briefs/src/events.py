import requests
import os
from datetime import date
from pydantic import BaseModel, field_validator
from typing import Optional
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


def get_events(date: str = None):
    url = f"https://meridian-production.alceos.workers.dev/events"

    if date:
        url += f"?date={date}"

    response = requests.get(
        url,
        headers={"Authorization": f"Bearer {os.environ.get('MERIDIAN_SECRET_KEY')}"},
    )
    data = response.json()

    sources = [Source(**source) for source in data["sources"]]
    events = [Event(**event) for event in data["events"]]

    return sources, events

# 本地数据库获取函数
def get_events_local(date: str = None):
    """从本地数据库获取文章数据，用于本地测试"""
    from sqlalchemy import create_engine, text
    
    db_url = os.environ.get('DATABASE_URL', 'postgresql://postgres:709323@localhost:5432/shiwenjie')
    engine = create_engine(db_url)
    
    with engine.connect() as conn:
        # 查询文章 - 注意字段名的调整
        if date:
            query = text(f"SELECT a.*, s.name as source_name FROM articles a JOIN sources s ON a.source_id = s.id WHERE DATE(a.publish_date) = '{date}'")
        else:
            query = text("SELECT a.*, s.name as source_name FROM articles a JOIN sources s ON a.source_id = s.id ORDER BY a.publish_date DESC LIMIT 100")
            
        articles_df = pd.read_sql(query, conn)
        
        # 打印调试信息
        print(f"获取到 {len(articles_df)} 篇文章")
        if len(articles_df) > 0:
            print(f"文章字段: {articles_df.columns.tolist()}")
        
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
            # 基本必填字段 - 注意字段名映射
            event_dict = {
                "id": int(row['id']),
                "sourceId": int(row['source_id']) if 'source_id' in row else None,  # 检查外键是否存在
                "url": row['url'],
                "title": row['title'],
                "publishDate": publish_date,  # 注意这里与数据库字段名保持一致
            }
            
            # 处理可能存在的字段
            # 内容处理 - 可能需要从文件中读取
            if 'content' in row and pd.notna(row['content']):
                event_dict["content"] = row['content']
            elif 'content_file_key' in row and pd.notna(row['content_file_key']):
                # 如果内容存储在文件中，这里可能需要读取文件
                event_dict["content"] = f"[内容存储在文件: {row['content_file_key']}]"
            else:
                event_dict["content"] = ""
            
            # 位置信息
            if 'primary_location' in row and pd.notna(row['primary_location']):
                event_dict["location"] = row['primary_location']
            else:
                event_dict["location"] = ""
            
            # 完整性评分
            if 'completeness' in row and pd.notna(row['completeness']):
                event_dict["completeness"] = str(row['completeness'])
            else:
                event_dict["completeness"] = ""
            
            # 相关性 - 可能需要从其他字段映射
            event_dict["relevance"] = ""
            
            # 摘要 - 可能需要从 event_summary_points 构建
            if 'event_summary_points' in row and pd.notna(row['event_summary_points']):
                # 如果是JSON格式的摘要点
                try:
                    import json
                    summary_points = json.loads(row['event_summary_points'])
                    if isinstance(summary_points, list):
                        event_dict["summary"] = "\n".join(summary_points)
                    else:
                        event_dict["summary"] = str(summary_points)
                except:
                    event_dict["summary"] = str(row['event_summary_points'])
            else:
                event_dict["summary"] = ""
            
            events.append(Event(**event_dict))
        except Exception as e:
            print(f"创建事件对象时出错: {e}")
            print(f"问题数据行: {row.to_dict()}")
            continue
    
    print(f"从本地数据库加载了 {len(events)} 篇文章和 {len(sources)} 个源")
    return sources, events

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
    
    # 测试 get_events_local 函数
    print("\n==== 测试 get_events_local 函数 ====")
    sources, events = get_events_local()
    print(f"获取的事件数: {len(events)}")
    print(f"获取的源数: {len(sources)}")
    
    # 如果有事件，打印第一个事件的详细信息
    if events:
        print("\n第一个事件的详细信息:")
        event = events[0]
        for field_name, field_value in event.model_dump().items():
            print(f"  {field_name}: {field_value}")
    else:
        print("\n没有获取到任何事件，请检查数据库或查询条件")
    
    print("==== 测试结束 ====")