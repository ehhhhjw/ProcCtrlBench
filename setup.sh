#!/bin/bash

echo "=== Agent评估系统安装脚本 ==="
echo ""

# 检查Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js未安装，请先安装Node.js >= 16"
    exit 1
fi

echo "✅ Node.js版本: $(node --version)"

# 检查npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm未安装"
    exit 1
fi

echo "✅ npm版本: $(npm --version)"
echo ""

# 清理npm缓存(如果遇到问题)
echo "清理npm缓存..."
npm cache clean --force 2>/dev/null || true

# 安装根目录依赖
echo "安装项目依赖..."
npm install --legacy-peer-deps || npm install --force || {
    echo "⚠️  npm install失败,尝试使用yarn..."
    if command -v yarn &> /dev/null; then
        yarn install
    else
        echo "❌ 安装失败。请手动运行: npm install --legacy-peer-deps"
        exit 1
    fi
}

# 安装ClaudeCodeStructure依赖
echo ""
echo "安装ClaudeCodeStructure依赖..."
cd ClaudeCodeStructure
npm install --legacy-peer-deps || npm install --force || {
    echo "⚠️  ClaudeCodeStructure依赖安装失败"
}
cd ..

# 编译TypeScript
echo ""
echo "编译TypeScript..."
if npx tsc --version &> /dev/null; then
    npm run build || {
        echo "⚠️  TypeScript编译失败，可能是因为依赖未完全安装"
        echo "请手动运行: npm run build"
    }
else
    echo "⚠️  TypeScript编译器未找到，跳过编译"
fi

echo ""
echo "=== 安装完成 ==="
echo ""
echo "下一步:"
echo "1. 运行示例: npm run example"
echo "2. 查看文档: cat README.md"
echo "3. 快速开始: cat QUICKSTART.md"
echo ""
