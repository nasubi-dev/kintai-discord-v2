#!/bin/bash

# Cloudflare KVネームスペースを作成するスクリプト

echo "Creating Cloudflare KV namespace 'kintai-discord-kv'..."

# KVネームスペースを作成
bun run wrangler kv:namespace create "kintai-discord-kv"

echo ""
echo "Please copy the generated binding and ID to your wrangler.jsonc file:"
echo "Replace 'your-kv-namespace-id-here' with the actual ID from the output above"
echo ""
echo "Example:"
echo "\"kv_namespaces\": ["
echo "  {"
echo "    \"binding\": \"KINTAI_DISCORD_KV\","
echo "    \"id\": \"abc123def456...\""
echo "  }"
echo "]"
