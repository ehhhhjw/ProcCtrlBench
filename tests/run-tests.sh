#!/bin/bash

# Test runner script
# Quickly runs the various tests

set -e

echo "🧪 AI Agent Evaluation Framework - Test Suite"
echo "================================"
echo ""

# Color definitions
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Error: Node.js not found${NC}"
    exit 1
fi

# Check npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ Error: npm not found${NC}"
    exit 1
fi

# Check dependencies
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}📦 Installing dependencies...${NC}"
    npm install
fi

# Build project
echo -e "${YELLOW}🔨 Building project...${NC}"
npm run build

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Build failed${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Build succeeded${NC}"
echo ""

# Run quick tests
echo -e "${YELLOW}🚀 Running quick tests...${NC}"
echo ""

npx ts-node tests/quick-test.ts

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✅ All tests passed!${NC}"
    exit 0
else
    echo ""
    echo -e "${RED}❌ Tests failed${NC}"
    exit 1
fi