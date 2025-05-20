#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import requests
import json
import argparse
from typing import Dict, Any, List, Optional
import time

class MeridianAIClient:
    """Meridian AI Worker API 客户端"""
    
    def __init__(self, base_url: str, api_key: str):
        self.base_url = base_url.rstrip('/')
        self.api_key = api_key
        self.headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
    
    def _request(self, method: str, endpoint: str, data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """发送 API 请求并处理响应"""
        url = f"{self.base_url}/{endpoint.lstrip('/')}"
        
        # 确保 API 密钥只包含 ASCII 字符
        headers = {
            "Authorization": f"Bearer {self.api_key.encode('ascii', 'ignore').decode('ascii')}",
            "Content-Type": "application/json"
        }
        
        try:
            if method.upper() == "GET":
                response = requests.get(url, headers=headers)
            else:
                response = requests.post(url, headers=headers, json=data)
            
            # 其余部分保持不变
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            print(f"请求错误: {e}")
            if hasattr(e, 'response') and e.response:
                try:
                    error_data = e.response.json()
                    print(f"API 错误: {json.dumps(error_data, ensure_ascii=False, indent=2)}")
                except:
                    print(f"状态码: {e.response.status_code}, 响应: {e.response.text}")
            return {"success": False, "error": str(e)}
    
    def health_check(self) -> Dict[str, Any]:
        """测试服务健康状态"""
        return self._request("GET", "/")
    
    def get_status(self) -> Dict[str, Any]:
        """获取 API 状态"""
        return self._request("GET", "/api/status")
    
    def get_models(self) -> Dict[str, Any]:
        """获取可用模型列表"""
        return self._request("GET", "/api/models")
    
    def chat(self, messages: List[Dict[str, str]], model: str = "gpt-4o") -> Dict[str, Any]:
        """测试聊天功能"""
        data = {
            "messages": messages,
            "model": model
        }
        return self._request("POST", "/api/chat", data)
    
    def generate_embedding(self, text: str, model: str = "text-embedding-3-large") -> Dict[str, Any]:
        """生成文本嵌入向量"""
        data = {
            "text": text,
            "model": model
        }
        return self._request("POST", "/api/embedding", data)
    
    def analyze_article(self, title: str, content: str, model: str = "gemini-2.0-flash") -> Dict[str, Any]:
        """分析文章内容"""
        data = {
            "title": title,
            "content": content,
            "model": model,
            "schema": {
                "type": "object",
                "properties": {
                    "language": {"type": "string", "description": "ISO 639-1 语言代码(2字母)"},
                    "primary_location": {"type": "string"},
                    "completeness": {
                        "type": "string", 
                        "enum": ["COMPLETE", "PARTIAL_USEFUL", "PARTIAL_USELESS"]
                    },
                    "content_quality": {
                        "type": "string", 
                        "enum": ["OK", "LOW_QUALITY", "JUNK"]
                    },
                    "event_summary_points": {"type": "array", "items": {"type": "string"}},
                    "thematic_keywords": {"type": "array", "items": {"type": "string"}},
                    "topic_tags": {"type": "array", "items": {"type": "string"}},
                    "key_entities": {"type": "array", "items": {"type": "string"}},
                    "content_focus": {"type": "array", "items": {"type": "string"}}
                },
                "required": ["language", "content_quality", "event_summary_points", "key_entities"]
            }
        }
        return self._request("POST", "/api/analyze", data)
    
    def generate_summary(self, content: str, format: str = "paragraph", model: str = "gpt-4o") -> Dict[str, Any]:
        """生成内容摘要"""
        data = {
            "content": content,
            "format": format,
            "model": model
        }
        return self._request("POST", "/api/summarize", data)


def print_result(title: str, result: Dict[str, Any]):
    """美化打印结果"""
    print(f"\n{'=' * 50}")
    print(f" {title}")
    print(f"{'=' * 50}")
    print(json.dumps(result, ensure_ascii=False, indent=2))


def main():
    """主函数：运行所有测试"""
    parser = argparse.ArgumentParser(description="测试 Meridian AI Worker API")
    parser.add_argument("--url", default="https://meridian-ai-worker.swj299792458.workers.dev", 
                        help="Meridian AI Worker 的基础 URL")
    parser.add_argument("--key", required=True, help="API 认证密钥")
    parser.add_argument("--test", choices=["all", "health", "status", "models", "chat", 
                                          "embedding", "analyze", "summarize"],
                        default="all", help="要运行的测试")
    
    args = parser.parse_args()
    client = MeridianAIClient(args.url, args.key)
    
    # 样本数据
    sample_article = {
        "title": "人工智能的发展与挑战",
        "content": """人工智能(AI)正在迅速改变我们的世界。从自动驾驶汽车到智能助手，AI技术已经渗透到我们日常生活的方方面面。
        然而，随着AI的发展，我们也面临着伦理、隐私和就业等挑战。如何在推动技术创新的同时解决这些问题，成为当今社会的重要课题。
        此外，AI在医疗、教育和环境保护等领域也展现出巨大潜力，有望帮助解决人类面临的一些最紧迫的问题。"""
    }
    
    sample_chat_messages = [
        {"role": "user", "content": "简单介绍一下量子计算的基本原理"}
    ]
    
    # 运行选定的测试
    if args.test in ["all", "health"]:
        print_result("健康检查", client.health_check())
        time.sleep(1)
    
    if args.test in ["all", "status"]:
        print_result("API 状态", client.get_status())
        time.sleep(1)
    
    if args.test in ["all", "models"]:
        print_result("可用模型", client.get_models())
        time.sleep(1)
    
    if args.test in ["all", "chat"]:
        print_result("聊天功能测试", client.chat(sample_chat_messages))
        time.sleep(1)
    
    if args.test in ["all", "embedding"]:
        print_result("嵌入向量生成测试", client.generate_embedding("这是一段用于测试嵌入向量生成的文本。"))
        time.sleep(1)
    
    if args.test in ["all", "analyze"]:
        print_result("文章分析测试", client.analyze_article(**sample_article))
        time.sleep(1)
    
    if args.test in ["all", "summarize"]:
        print_result("摘要生成测试", client.generate_summary(sample_article["content"]))


if __name__ == "__main__":
    main()