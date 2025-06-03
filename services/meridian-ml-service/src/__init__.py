"""
Meridian ML Service - 精简核心版本
AI驱动的智能聚类分析服务
"""

__version__ = "3.0.0"
__author__ = "Meridian Team"
__description__ = "AI驱动的智能聚类分析服务"

from .main import app
from .config import settings

__all__ = ["app", "settings"]
