#!/bin/bash

# 测试执行脚本
# 用于快速运行各种测试

set -e

echo "🧪 AI Agent 评估框架 - 测试套件"
echo "================================"
echo ""

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ 错误: 未找到 Node.js${NC}"
    exit 1
fi

# 检查 npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ 错误: 未找到 npm${NC}"
    exit 1
fi

# 检查依赖
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}📦 安装依赖...${NC}"
    npm install
fi

# 编译项目
echo -e "${YELLOW}🔨 编译项目...${NC}"
npm run build

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ 编译失败${NC}"
    exit 1
fi

echo -e "${GREEN}✅ 编译成功${NC}"
echo ""

# 运行快速测试
echo -e "${YELLOW}🚀 运行快速测试...${NC}"
echo ""

npx ts-node tests/quick-test.ts

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✅ 所有测试通过！${NC}"
    exit 0
else
    echo ""
    echo -e "${RED}❌ 测试失败${NC}"
    exit 1
fi