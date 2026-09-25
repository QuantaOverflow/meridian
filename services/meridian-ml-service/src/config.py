"""
配置管理模块
"""

import os


class Settings:
    """应用配置"""
    
    def __init__(self):
        # 模型配置
        self.embedding_model_name = os.getenv("EMBEDDING_MODEL_NAME", "sentence-transformers/multilingual-e5-small")
        
        # API配置
        self.api_token = os.getenv("API_TOKEN", "")


# 全局设置实例
settings = Settings()
