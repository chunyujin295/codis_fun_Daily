#!/bin/bash
set -e

# 创建临时测试目录
TEST_DIR=$(mktemp -d)
echo "创建测试目录: $TEST_DIR"

# 创建测试HTML文件
cat > "$TEST_DIR/test-article.html" << 'EOF'
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>测试文章</title>
</head>
<body>
    <article>
        <h1>外部发布测试</h1>
        <p>这是一个从项目外部目录发布的测试文章。</p>
        <p>测试时间: $(date)</p>
        <p>测试环境: $(uname -s) $(uname -m)</p>
    </article>
</body>
</html>
EOF

# 创建测试元数据文件
cat > "$TEST_DIR/test-article.metadata.json" << 'EOF'
{
    "schemaVersion": "1",
    "uploaderId": "demo-agent",
    "externalId": "test-external-publish-$(date +%s)",
    "title": "外部发布测试",
    "summary": "从项目外部目录发布的测试文章",
    "category": "technology",
    "generatedAt": "$(date -Iseconds)",
    "tags": ["测试", "外部发布"],
    "language": "zh-CN"
}
EOF

echo "测试文件已创建:"
echo "  HTML: $TEST_DIR/test-article.html"
echo "  元数据: $TEST_DIR/test-article.metadata.json"

# 复制发布脚本到临时目录
cp "$(dirname "$0")/push-article.mjs" "$TEST_DIR/"
cp "$(dirname "$0")/../.env.agent.example" "$TEST_DIR/" 2>/dev/null || true

echo ""
echo "测试步骤:"
echo "1. 进入测试目录: cd $TEST_DIR"
echo "2. 配置环境变量: cp .env.agent.example .env.agent"
echo "3. 编辑 .env.agent 设置 DAILY_BASE_URL 和 DAILY_UPLOAD_TOKEN"
echo "4. 运行发布: node push-article.mjs test-article.html"
echo ""
echo "或者使用 npm 脚本:"
echo "  cd $TEST_DIR && node $(dirname "$0")/push-article.mjs test-article.html"

# 清理函数
cleanup() {
    echo ""
    echo "清理测试文件..."
    rm -rf "$TEST_DIR"
    echo "清理完成"
}

# 注册清理函数
trap cleanup EXIT

echo ""
echo "测试目录: $TEST_DIR"
echo "按任意键清理并退出，或 Ctrl+C 取消清理"
read -n 1 -s