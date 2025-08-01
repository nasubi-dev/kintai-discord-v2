#!/usr/bin/env node

/**
 * 簡単なサーバー数のみ取得ツール
 */

const DISCORD_API_BASE = "https://discord.com/api/v10";

async function getGuildCount() {
  // 環境変数からBotトークンを取得（DISCORD_TOKENまたはDISCORD_BOT_TOKEN）
  const BOT_TOKEN = process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN;

  if (!BOT_TOKEN) {
    console.error("❌ エラー: DISCORD_TOKEN または DISCORD_BOT_TOKEN 環境変数が設定されていません");
    process.exit(1);
  }

  try {
    const response = await fetch(`${DISCORD_API_BASE}/users/@me/guilds`, {
      headers: {
        Authorization: `Bot ${BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Discord API エラー: ${response.status} ${response.statusText}`);
    }

    const guilds = await response.json();
    const guildCount = Array.isArray(guilds) ? guilds.length : 0;

    console.log(guildCount);
  } catch (error) {
    console.error("❌ エラー:", error.message);
    process.exit(1);
  }
}

// メイン実行
getGuildCount();
