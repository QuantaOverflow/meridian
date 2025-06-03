#!/usr/bin/env python3
"""
测试运行器 - 可从test目录直接运行
"""

import sys
import os
import subprocess
from pathlib import Path

# 颜色输出
RED = '\033[0;31m'
GREEN = '\033[0;32m'
YELLOW = '\033[1;33m'
NC = '\033[0m'

def print_colored(message, color=NC):
    print(f"{color}{message}{NC}")

def check_service_running():
    """检查ML服务是否运行，并返回健康数据。
    返回 (bool, dict) 表示 (是否运行, 健康数据)，失败时返回 (False, None)。
    """
    try:
        import requests
        response = requests.get("http://localhost:8081/health", timeout=5)
        if response.status_code == 200:
            return True, response.json() # 返回健康数据
        else:
            print_colored(f"⚠️  ML服务返回非200状态码: {response.status_code}", YELLOW)
            return False, None
    except requests.exceptions.ConnectionError:
        print_colored("❌ 无法连接到ML服务。请确保服务已启动并监听在 http://localhost:8081。", RED)
        return False, None
    except Exception as e:
        print_colored(f"❌ 检查ML服务时发生异常: {e}", RED)
        return False, None

def install_dependencies():
    """检查和指导安装测试依赖"""
    print_colored("📦 检查测试依赖...", YELLOW)
    
    # 尝试导入必要的库，如果失败则提示用户手动安装
    required_libs = {
        "requests": "requests",
        "numpy": "numpy",
        "umap": "umap-learn",
        "hdbscan": "hdbscan",
        "sklearn": "scikit-learn"
    }
    
    missing_libs = []
    for import_name, package_name in required_libs.items():
        try:
            __import__(import_name)
        except ImportError:
            missing_libs.append(package_name)
            
    if missing_libs:
        print_colored(f"❌ 缺少以下测试依赖: {', '.join(missing_libs)}", RED)
        print_colored("请在激活虚拟环境后运行以下命令安装:", YELLOW)
        print_colored(f"   uv pip install {' '.join(missing_libs)}", NC)
        print_colored("或 (如果uv未安装):", NC)
        print_colored(f"   pip install {' '.join(missing_libs)}", NC)
        return False
    
    print_colored("✅ 所有测试依赖已安装", GREEN)
    return True

def run_unified_tests():
    """运行统一测试套件"""
    print_colored("🧪 运行统一测试套件...", YELLOW)
    
    # 切换到test目录
    test_dir = Path(__file__).parent
    os.chdir(test_dir)
    
    try:
        # 运行统一测试
        result = subprocess.run([sys.executable, "test_ml_service.py"], 
                              capture_output=False, text=True)
        return result.returncode == 0
    except Exception as e:
        print_colored(f"❌ 运行测试异常: {e}", RED)
        return False

def run_specific_tests():
    """运行特定测试"""
    test_dir = Path(__file__).parent
    os.chdir(test_dir)
    
    tests = [
        ("test_small_dataset.py", "小数据集测试"),
        ("test_with_mock_articles.py", "模拟文章测试")
    ]
    
    for test_file, description in tests:
        if os.path.exists(test_file):
            print_colored(f"\n🎯 运行{description}...", YELLOW)
            try:
                result = subprocess.run([sys.executable, test_file], 
                                      capture_output=False, text=True)
                if result.returncode == 0:
                    print_colored(f"✅ {description}通过", GREEN)
                else:
                    print_colored(f"❌ {description}失败", RED)
            except Exception as e:
                print_colored(f"❌ {description}异常: {e}", RED)

def main():
    """主函数"""
    print_colored("🤖 Meridian ML Service 测试运行器", GREEN)
    print_colored("=" * 50, GREEN)
    
    # 1. 检查服务状态
    service_is_running, health_data = check_service_running() # 获取健康数据
    
    if service_is_running:
        print_colored("✅ ML服务正在运行", GREEN)
        if health_data: # 如果成功获取到健康数据
            print_colored(f"   嵌入模型: {health_data.get('embedding_model', 'N/A')}", NC)
            print_colored(f"   聚类可用: {health_data.get('clustering_available', 'Unknown')}", NC)
            print_colored(f"   优化可用: {health_data.get('optimization_available', 'Unknown')}", NC)
            
            # 检查并警告功能不可用
            if not health_data.get('clustering_available', True): # 默认为True，如果键不存在
                print_colored("⚠️  警告: ML服务报告聚类功能不可用！", YELLOW)
                print_colored("   请检查服务日志以获取详细信息。", YELLOW)
                if 'warnings' in health_data:
                    for warning in health_data['warnings']:
                        print_colored(f"   - {warning}", YELLOW)
            if not health_data.get('optimization_available', True):
                print_colored("⚠️  警告: ML服务报告优化功能不可用！", YELLOW)
                print_colored("   请检查服务日志以获取详细信息。", YELLOW)
        else:
            print_colored("⚠️  警告: 无法获取到健康数据", YELLOW)
    else:
        print_colored("⚠️  ML服务未运行或健康检查失败，请先启动服务:", YELLOW)
        print_colored("   cd .. && ./start_local.sh --dev", NC)
        print_colored("   或者: cd .. && ./start_local.sh --docker", NC)
        return
    
    # 2. 安装依赖
    if not install_dependencies():
        return
    
    # 3. 运行测试
    print_colored("\n" + "=" * 50, GREEN)
    
    # 统一测试套件
    success = run_unified_tests()
    
    if success:
        print_colored("\n🎉 统一测试套件通过！", GREEN)
        
        # 询问是否运行特定测试
        try:
            choice = input("\n是否运行特定测试? (y/N): ").strip().lower()
            if choice in ['y', 'yes']:
                run_specific_tests()
        except KeyboardInterrupt:
            print_colored("\n👋 测试被用户中断", YELLOW)
    else:
        print_colored("\n❌ 统一测试套件失败", RED)
    
    print_colored("\n📚 使用说明:", GREEN)
    print_colored("  从test目录运行: python3 run_tests.py", NC)
    print_colored("  从项目根目录: python test/run_tests.py", NC)

if __name__ == "__main__":
    main() 