"""
配置管理模块
"""

import os


class Settings:
    """应用配置"""
    
    def __init__(self):
        # 模型配置
        self.embedding_model_name = os.getenv("EMBEDDING_MODEL_NAME", "sentence-transformers/multilingual-e5-small")
        self.expected_embedding_dimensions = int(os.getenv("EXPECTED_EMBEDDING_DIMENSIONS", "384"))
        
        # API配置
        self.api_token = os.getenv("API_TOKEN", "")
        
        # 服务配置
        self.service_name = "meridian-ml-service"
        self.version = "3.0.0"
        
        # 性能配置
        self.batch_size = int(os.getenv("BATCH_SIZE", "32"))
        self.max_text_length = int(os.getenv("MAX_TEXT_LENGTH", "512"))


# 全局设置实例
settings = Settings()
