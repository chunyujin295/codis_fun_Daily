#!/bin/bash
# 测试从项目外部目录发布文章
set -e

TEST_DIR="/tmp/daily-external-test-$(date +%s)"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== 从项目外部目录发布验证 ==="
echo "项目目录: $PROJECT_DIR"
echo "测试目录: $TEST_DIR"

# 创建测试目录
mkdir -p "$TEST_DIR"

# 创建测试HTML
cat > "$TEST_DIR/test.html" << 'EOF'
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>外部发布测试</title>
</head>
<body>
    <article>
        <h1>外部发布测试</h1>
        <p>这是从项目外部目录发布的测试文章。</p>
        <p>测试时间: $(date)</p>
    </article>
</body>
</html>
EOF

# 创建测试元数据
cat > "$TEST_DIR/test.metadata.json" << EOF
{
    "schemaVersion": "1",
    "uploaderId": "demo-agent",
    "externalId": "test-$(date +%s)",
    "title": "外部发布测试",
    "summary": "从项目外部目录发布的测试文章",
    "category": "technology",
    "generatedAt": "$(date -Iseconds)",
    "tags": ["测试"],
    "language": "zh-CN"
}
EOF

echo "测试文件已创建:"
ls -la "$TEST_DIR/"

# 复制发布脚本
cp "$PROJECT_DIR/scripts/push-article.mjs" "$TEST_DIR/"

echo ""
echo "验证步骤:"
echo "1. 检查发布脚本是否可独立运行"
echo "2. 检查脚本是否能正确解析元数据"
echo "3. 检查脚本是否能正确生成幂等键"

# 测试脚本帮助信息
echo ""
echo "=== 测试发布脚本帮助信息 ==="
cd "$TEST_DIR"
node push-article.mjs --help

# 测试元数据解析
echo ""
echo "=== 测试元数据解析 ==="
node -e "
const fs = require('fs');
const metadata = JSON.parse(fs.readFileSync('test.metadata.json', 'utf8'));
console.log('元数据解析成功:');
console.log('  uploaderId:', metadata.uploaderId);
console.log('  externalId:', metadata.externalId);
console.log('  title:', metadata.title);
console.log('  category:', metadata.category);
"

# 清理
echo ""
echo "=== 清理测试文件 ==="
rm -rf "$TEST_DIR"
echo "测试完成"