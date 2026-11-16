#!/bin/bash

echo "=== Agent Evaluation System Setup Script ==="
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js >= 16 first"
    exit 1
fi

echo "✅ Node.js version: $(node --version)"

# Check npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed"
    exit 1
fi

echo "✅ npm version: $(npm --version)"
echo ""

# Clean the npm cache (in case of problems)
echo "Cleaning npm cache..."
npm cache clean --force 2>/dev/null || true

# Install root directory dependencies
echo "Installing project dependencies..."
npm install --legacy-peer-deps || npm install --force || {
    echo "⚠️  npm install failed, trying yarn instead..."
    if command -v yarn &> /dev/null; then
        yarn install
    else
        echo "❌ Install failed. Please run manually: npm install --legacy-peer-deps"
        exit 1
    fi
}

# Install ClaudeCodeStructure dependencies
echo ""
echo "Installing ClaudeCodeStructure dependencies..."
cd ClaudeCodeStructure
npm install --legacy-peer-deps || npm install --force || {
    echo "⚠️  Failed to install ClaudeCodeStructure dependencies"
}
cd ..

# Build TypeScript
echo ""
echo "Building TypeScript..."
if npx tsc --version &> /dev/null; then
    npm run build || {
        echo "⚠️  TypeScript build failed, possibly because dependencies were not fully installed"
        echo "Please run manually: npm run build"
    }
else
    echo "⚠️  TypeScript compiler not found, skipping build"
fi

echo ""
echo "=== Install Complete ==="
echo ""
echo "Next steps:"
echo "1. Run the example: npm run example"
echo "2. Read the docs: cat README.md"
echo "3. Quick start: cat QUICKSTART.md"
echo ""
