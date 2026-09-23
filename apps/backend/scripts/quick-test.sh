#!/bin/bash

# Meridian Backend 快速测试启动脚本
# 使用方法: ./apps/backend/scripts/quick-test.sh [test_type] [source_id]

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 项目根目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

echo -e "${BLUE}🚀 Meridian Backend 测试启动器${NC}"
echo "================================================="

# 默认参数
TEST_TYPE=${1:-"stats"}
SOURCE_ID=${2:-""}

# 显示使用说明
show_usage() {
    echo "使用方法:"
    echo "  $0 [test_type] [source_id]"
    echo ""
    echo "测试类型:"
    echo "  monitor   - 仅启动数据库监控"
    echo "  stats     - 显示数据库统计 (默认)"
    echo ""
    echo "示例:"
    echo "  $0 monitor       # 启动数据库监控"
    echo "  $0 stats         # 显示数据库统计"
    echo ""
}

# 检查帮助参数
if [[ "$1" == "-h" ]] || [[ "$1" == "--help" ]]; then
    show_usage
    exit 0
fi

# 检查环境
check_environment() {
    echo -e "${YELLOW}🔍 检查环境...${NC}"
    
    # 检查是否在正确的目录
    if [ ! -f "$PROJECT_ROOT/package.json" ]; then
        echo -e "${RED}❌ 错误: 请在项目根目录运行此脚本${NC}"
        exit 1
    fi
    
    # 检查Node.js
    if ! command -v node &> /dev/null; then
        echo -e "${RED}❌ 错误: 未找到Node.js，请先安装Node.js${NC}"
        exit 1
    fi
    
    # 检查psql
    if ! command -v psql &> /dev/null; then
        echo -e "${RED}❌ 错误: 未找到psql，请先安装PostgreSQL客户端${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✅ 环境检查通过${NC}"
}

# 检查服务状态
check_services() {
    echo -e "${YELLOW}🔍 检查服务状态...${NC}"
    
    # 检查Backend服务
    if curl -s http://localhost:8787/ping > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Backend服务 (localhost:8787) 正常${NC}"
    else
        echo -e "${RED}❌ Backend服务不可用${NC}"
        echo "   请确保在另一个终端运行: cd apps/backend && wrangler dev"
        exit 1
    fi
    
    # 检查数据库连接
    DB_URL=${DATABASE_URL:-"postgresql://postgres@localhost:5432/shiwenjie"}
    if psql "$DB_URL" -c "SELECT 1;" > /dev/null 2>&1; then
        echo -e "${GREEN}✅ 数据库连接正常${NC}"
    else
        echo -e "${RED}❌ 数据库连接失败${NC}"
        echo "   请检查数据库是否运行，以及DATABASE_URL是否正确"
        exit 1
    fi
    
}

# 启动监控
run_monitor() {
    echo -e "${BLUE}📊 启动数据库监控...${NC}"
    echo -e "${YELLOW}按 Ctrl+C 停止监控${NC}"
    echo ""
    
    node "$PROJECT_ROOT/apps/backend/scripts/monitor-database.js"
}

# 显示数据库统计
show_stats() {
    echo -e "${BLUE}📊 显示数据库统计...${NC}"
    echo ""
    
    "$PROJECT_ROOT/apps/backend/scripts/db-stats.sh"
}

# 主逻辑
main() {
    # 切换到项目根目录
    cd "$PROJECT_ROOT"
    
    # 检查环境和服务
    check_environment
    check_services
    
    echo ""
    echo -e "${BLUE}测试类型: $TEST_TYPE${NC}"
    if [ -n "$SOURCE_ID" ]; then
        echo -e "${BLUE}RSS源ID: $SOURCE_ID${NC}"
    fi
    echo ""
    
    case "$TEST_TYPE" in
        "monitor")
            run_monitor
            ;;
        "stats")
            show_stats
            ;;
        *)
            echo -e "${RED}❌ 错误: 未知的测试类型 '$TEST_TYPE'${NC}"
            echo ""
            show_usage
            exit 1
            ;;
    esac
}

# 错误处理
trap 'echo -e "\n${RED}❌ 测试被中断${NC}"' INT

# 运行主函数
main "$@" 