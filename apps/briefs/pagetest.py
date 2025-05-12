import os
import time
import json
from datetime import datetime
from dotenv import load_dotenv
import argparse

# 导入事件获取函数
from src.events import get_events, get_events_with_pagination

# 加载环境变量
load_dotenv()

# 确保API密钥存在
if not os.environ.get('MERIDIAN_SECRET_KEY'):
    raise EnvironmentError("环境变量 'MERIDIAN_SECRET_KEY' 未设置！请在.env文件中设置。")

def test_pagination(date=None, page_size=20, save_results=True):
    """
    测试分页抓取功能，对比分页和非分页结果
    
    参数:
        date: 可选的日期过滤 (YYYY-MM-DD)
        page_size: 每页的记录数
        save_results: 是否保存结果到文件
    """
    print(f"\n{'='*30} 分页抓取测试 {'='*30}")
    print(f"测试参数: 日期={date or '全部'}, 页面大小={page_size}")
    
    # 1. 使用普通方式获取数据（一次性获取全部）
    print("\n[1] 使用普通方式获取数据（一次性获取全部）...")
    start_time = time.time()
    try:
        normal_response = get_events(date)
        normal_elapsed = time.time() - start_time
        print(f"完成! 耗时: {normal_elapsed:.2f}秒")
        print(f"获取到 {len(normal_response.events)} 条事件")
    except Exception as e:
        print(f"普通获取失败: {str(e)}")
        normal_response = None
        normal_elapsed = 0
    
    # 2. 使用分页方式获取数据
    print("\n[2] 使用分页方式获取数据...")
    start_time = time.time()
    try:
        paged_response = get_events_with_pagination(date, page_size=page_size)
        paged_elapsed = time.time() - start_time
        print(f"完成! 耗时: {paged_elapsed:.2f}秒")
        print(f"分页获取到 {len(paged_response.events)} 条事件")
    except Exception as e:
        print(f"分页获取失败: {str(e)}")
        import traceback
        traceback.print_exc()
        paged_response = None
        paged_elapsed = 0
    
    # 3. 比较结果
    if normal_response and paged_response:
        print("\n[3] 比较两种方式的结果...")
        
        # 提取事件ID进行比较
        normal_ids = {event.id for event in normal_response.events}
        paged_ids = {event.id for event in paged_response.events}
        
        # 计算差异
        only_in_normal = normal_ids - paged_ids
        only_in_paged = paged_ids - normal_ids
        common_ids = normal_ids.intersection(paged_ids)
        
        print(f"普通方式特有的事件: {len(only_in_normal)} 条")
        print(f"分页方式特有的事件: {len(only_in_paged)} 条")
        print(f"两种方式共同的事件: {len(common_ids)} 条")
        
        if only_in_normal:
            print(f"普通方式特有ID(前10个): {list(only_in_normal)[:10]}")
        if only_in_paged:
            print(f"分页方式特有ID(前10个): {list(only_in_paged)[:10]}")
        
        # 计算完整性百分比
        if normal_ids:
            paged_completeness = len(common_ids) / len(normal_ids) * 100
            print(f"分页方式获取的完整性: {paged_completeness:.2f}%")
    
    # 4. 保存结果
    if save_results and paged_response:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"paged_events_{timestamp}.json"
        
        # 将结果转换为字典
        result_dict = {
            "sources": [source.model_dump() for source in paged_response.sources],
            "events": [event.model_dump(mode='json') for event in paged_response.events],
            "total": paged_response.total,
            "metadata": {
                "date_filter": date,
                "page_size": page_size,
                "elapsed_time": paged_elapsed,
                "timestamp": timestamp
            }
        }
        
        # 保存到文件
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(result_dict, f, ensure_ascii=False, indent=2, default=str)
        
        print(f"\n结果已保存到文件: {filename}")
    
    # 5. 总结
    print("\n测试总结:")
    if normal_response:
        print(f"普通方式: {len(normal_response.events)} 条记录, 耗时 {normal_elapsed:.2f}秒")
    if paged_response:
        print(f"分页方式: {len(paged_response.events)} 条记录, 耗时 {paged_elapsed:.2f}秒")
    
    if normal_response and paged_response:
        # 比较性能
        if normal_elapsed > 0:
            speed_ratio = paged_elapsed / normal_elapsed
            print(f"性能比较: 分页方式耗时是普通方式的 {speed_ratio:.2f} 倍")
        # 比较完整性
        if len(normal_response.events) > 0:
            completeness = len(paged_response.events) / len(normal_response.events) * 100
            print(f"数据完整性: {completeness:.2f}%")
    
    print(f"{'='*80}")
    
    if paged_response:
        return paged_response
    return None


if __name__ == "__main__":
    # 命令行参数解析
    parser = argparse.ArgumentParser(description="测试分页抓取功能")
    parser.add_argument("--date", help="按日期筛选，格式YYYY-MM-DD", type=str, default=None)
    parser.add_argument("--pagesize", help="每页记录数量", type=int, default=20)
    parser.add_argument("--nosave", help="不保存结果到文件", action="store_true")
    
    args = parser.parse_args()
    
    # 执行测试
    test_pagination(
        date=args.date, 
        page_size=args.pagesize,
        save_results=not args.nosave
    )
