#!/usr/bin/env python3
"""
模拟文章生成器 - 使用 Meridian AI Worker 生成真实内容
生成不同主题的模拟文章，用于测试ML服务的聚类功能
"""

import asyncio
import httpx
import json
from typing import List, Dict, Any
import time

# AI Worker 配置
AI_WORKER_BASE_URL = "https://meridian-ai-worker.swj299792458.workers.dev"
API_TOKEN = "j+96PlDDJPVI7dAhoxdWfgynQTxqEzf5vnea6wrhKXg="  # 开发环境token

# 文章主题和相应的生成prompt
ARTICLE_TOPICS = [
    {
        "category": "technology",
        "title": "人工智能在医疗诊断中的突破性进展",
        "prompt": "写一篇关于人工智能在医疗诊断领域最新突破的新闻文章。内容应包含：具体的技术突破、研究机构、临床应用案例、专家观点、未来展望。文章长度约800-1000字，语言专业但易懂。"
    },
    {
        "category": "technology", 
        "title": "量子计算在金融风险分析中的应用研究",
        "prompt": "撰写一篇关于量子计算技术在金融风险分析和投资组合优化中应用的深度报道。包含技术原理、实际案例、业界反应、监管考虑。约900字。"
    },
    {
        "category": "technology",
        "title": "5G网络推动智慧城市基础设施升级",
        "prompt": "报道5G技术如何推动智慧城市建设，包括交通管理、环境监测、公共安全等方面的创新应用。提及具体城市案例和技术细节。800-1000字。"
    },
    {
        "category": "finance",
        "title": "央行数字货币试点项目最新进展分析",
        "prompt": "分析全球主要央行数字货币（CBDC）的试点项目现状，包括中国数字人民币、欧洲数字欧元等。涵盖技术架构、政策影响、市场反应。约900字。"
    },
    {
        "category": "finance",
        "title": "ESG投资理念重塑全球资本市场格局", 
        "prompt": "深度分析ESG（环境、社会、治理）投资理念对全球资本市场的影响，包括投资策略变化、企业估值重构、监管政策趋势。800-1000字。"
    },
    {
        "category": "finance",
        "title": "加密货币市场监管框架逐步完善",
        "prompt": "报道各国加密货币监管政策的最新发展，分析监管框架对市场的影响，包括合规要求、机构参与、技术创新等方面。约900字。"
    },
    {
        "category": "geopolitics",
        "title": "中美科技竞争对全球供应链的深层影响",
        "prompt": "分析中美在半导体、人工智能等关键技术领域的竞争如何重塑全球供应链格局，包括产业转移、技术标准、国际合作等。800-1000字。"
    },
    {
        "category": "geopolitics", 
        "title": "欧盟数字主权战略的全球影响与挑战",
        "prompt": "深度解析欧盟数字主权战略的核心内容、实施进展及其对全球数字经济治理的影响，包括数据保护、技术自主、国际合作等方面。约900字。"
    },
    {
        "category": "geopolitics",
        "title": "新兴市场国家在全球治理中的作用增强",
        "prompt": "分析BRICS等新兴市场国家在国际金融体系、气候治理、数字经济等领域发挥的重要作用及其对现有国际秩序的影响。800-1000字。"
    },
    {
        "category": "environment",
        "title": "碳中和目标推动清洁能源技术创新加速",
        "prompt": "报道全球碳中和承诺如何催生清洁能源技术的重大突破，包括储能技术、氢能发展、碳捕获等创新领域。涵盖技术进展和商业化前景。约900字。"
    },
    {
        "category": "environment",
        "title": "生物多样性保护的科技创新与政策协调",
        "prompt": "分析科技创新在生物多样性保护中的应用，包括AI监测技术、基因保护技术、生态系统恢复等，以及国际政策协调机制。800-1000字。"
    },
    {
        "category": "environment", 
        "title": "极端气候事件频发凸显适应性治理紧迫性",
        "prompt": "深度报道近期全球极端气候事件的影响，分析气候适应性治理的创新实践，包括城市韧性建设、灾害预警系统、国际合作机制。约900字。"
    }
]

class MockArticleGenerator:
    def __init__(self, base_url: str, api_token: str):
        self.base_url = base_url.rstrip('/')
        self.api_token = api_token
        self.headers = {
            'Content-Type': 'application/json'
        }
    
    async def generate_article_content(self, title: str, prompt: str) -> str:
        """使用AI Worker生成文章内容"""
        
        # 构建文章分析请求 - 使用meridian专用端点
        article_request = {
            "title": title,
            "content": f"{prompt}\n\n请为标题'{title}'生成一篇完整的新闻文章。",
        }
        
        async with httpx.AsyncClient(timeout=60) as client:
            try:
                response = await client.post(
                    f"{self.base_url}/meridian/article/analyze",
                    json=article_request,
                    headers=self.headers
                )
                
                if response.status_code == 200:
                    result = response.json()
                    print(f"   📡 API响应: {response.status_code}")
                    
                    # 检查响应格式
                    if result.get('success') and 'data' in result:
                        # 从分析结果构建文章内容
                        analysis = result['data']
                        
                        # 构建简单的文章内容
                        content_parts = []
                        content_parts.append(f"# {title}\n")
                        
                        if analysis.get('event_summary_points'):
                            content_parts.append("## 核心要点")
                            for point in analysis['event_summary_points'][:3]:
                                content_parts.append(f"- {point}")
                            content_parts.append("")
                        
                        if analysis.get('thematic_keywords'):
                            keywords = ', '.join(analysis['thematic_keywords'][:5])
                            content_parts.append(f"**关键词**: {keywords}\n")
                        
                        # 添加基础内容
                        content_parts.append("这是一篇关于以上主题的深度分析文章。本文探讨了相关的技术发展、市场趋势和社会影响。")
                        content_parts.append("")
                        content_parts.append("## 详细分析")
                        content_parts.append("随着科技的快速发展和全球化的深入推进，这一领域正在经历前所未有的变革。")
                        content_parts.append("")
                        content_parts.append("## 未来展望")
                        content_parts.append("展望未来，这一趋势将继续影响相关行业的发展方向，值得持续关注。")
                        
                        if analysis.get('key_entities'):
                            entities = ', '.join(analysis['key_entities'][:3])
                            content_parts.append(f"\n**相关实体**: {entities}")
                        
                        generated_content = '\n'.join(content_parts)
                        return generated_content
                    else:
                        print(f"   ❌ 响应格式错误: {result}")
                        return None
                else:
                    print(f"   ❌ HTTP错误 {response.status_code}: {response.text}")
                    return None
                    
            except Exception as e:
                print(f"   ❌ 请求异常: {e}")
                return None
    
    async def generate_all_articles(self) -> List[Dict[str, Any]]:
        """生成所有模拟文章"""
        
        print(f"🚀 开始生成 {len(ARTICLE_TOPICS)} 篇模拟文章...")
        print(f"📡 AI Worker: {self.base_url}")
        
        articles = []
        
        for i, topic in enumerate(ARTICLE_TOPICS, 1):
            print(f"\n📝 [{i}/{len(ARTICLE_TOPICS)}] 生成文章: {topic['title']}")
            
            content = await self.generate_article_content(
                topic['title'], 
                topic['prompt']
            )
            
            if content:
                article = {
                    "id": i,
                    "title": topic['title'],
                    "content": content,
                    "category": topic['category'],
                    "generated_at": time.time()
                }
                articles.append(article)
                print(f"   ✅ 成功生成 ({len(content)} 字符)")
            else:
                print(f"   ❌ 生成失败")
            
            # 避免请求过于频繁
            await asyncio.sleep(2)
        
        return articles
    
    async def save_articles(self, articles: List[Dict[str, Any]], filename: str = "mock_articles.json"):
        """保存生成的文章到文件"""
        
        output_data = {
            "generated_at": time.time(),
            "total_articles": len(articles),
            "categories": list(set(article['category'] for article in articles)),
            "articles": articles
        }
        
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(output_data, f, ensure_ascii=False, indent=2)
        
        print(f"\n💾 已保存 {len(articles)} 篇文章到 {filename}")
        
        # 生成统计信息
        category_stats = {}
        total_length = 0
        
        for article in articles:
            cat = article['category']
            category_stats[cat] = category_stats.get(cat, 0) + 1
            total_length += len(article['content'])
        
        print(f"📊 统计信息:")
        print(f"   - 总文章数: {len(articles)}")
        print(f"   - 总字符数: {total_length:,}")
        print(f"   - 平均长度: {total_length // len(articles):,} 字符")
        
        for cat, count in category_stats.items():
            print(f"   - {cat}: {count} 篇")

async def main():
    """主函数"""
    print("🎯 Meridian 模拟文章生成器")
    print("=" * 50)
    
    # 初始化生成器
    generator = MockArticleGenerator(AI_WORKER_BASE_URL, API_TOKEN)
    
    # 生成文章
    articles = await generator.generate_all_articles()
    
    if articles:
        # 保存到文件
        await generator.save_articles(articles)
        
        print(f"\n🎉 完成！生成了 {len(articles)} 篇模拟文章")
        print("💡 现在可以使用这些文章测试ML服务的聚类功能")
    else:
        print("\n😞 没有成功生成任何文章")

if __name__ == "__main__":
    asyncio.run(main()) 