#!/usr/bin/env node

/**
 * Discord Bot が参加しているサーバー（ギルド）一覧を取得・表示するスクリプト
 */

const DISCORD_API_BASE = "https://discord.com/api/v10";

async function listGuilds() {
  // 環境変数からBotトークンを取得（DISCORD_TOKENまたはDISCORD_BOT_TOKEN）
  const BOT_TOKEN = process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN;
  
  if (!BOT_TOKEN) {
    console.error("❌ エラー: DISCORD_TOKEN または DISCORD_BOT_TOKEN 環境変数が設定されていません");
    console.log("💡 解決方法:");
    console.log("   export DISCORD_TOKEN=your_bot_token_here");
    console.log("   または");
    console.log("   DISCORD_TOKEN=your_bot_token_here bun run scripts/list-guilds.js");
    process.exit(1);
  }

  try {
    console.log("🔍 Discord Bot が参加しているサーバーを取得中...\n");

    const response = await fetch(`${DISCORD_API_BASE}/users/@me/guilds`, {
      headers: {
        Authorization: `Bot ${BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Discord API エラー: ${response.status} ${response.statusText}\n${errorText}`);
    }

    const guilds = await response.json();

    if (guilds.length === 0) {
      console.log("ℹ️  このBotはまだどのサーバーにも参加していません");
      console.log("💡 Botを招待するには、Discord Developer Portal で招待URLを生成してください");
      return;
    }

    console.log(`✅ 合計 ${guilds.length} 個のサーバーに参加しています:\n`);
    
    // ヘッダー
    console.log("┌─────────────────────────────────────────┬──────────────────────┬────────────┬──────────────┐");
    console.log("│ サーバー名                              │ サーバーID           │ メンバー数 │ 権限         │");
    console.log("├─────────────────────────────────────────┼──────────────────────┼────────────┼──────────────┤");

    for (const guild of guilds) {
      // サーバー名を40文字でトリミング
      const name = guild.name.length > 35 
        ? guild.name.substring(0, 32) + "..." 
        : guild.name;
      
      // 権限の確認（管理者権限があるかチェック）
      const permissions = parseInt(guild.permissions);
      const hasAdmin = (permissions & 0x8) === 0x8; // ADMINISTRATOR permission
      const hasManageGuild = (permissions & 0x20) === 0x20; // MANAGE_GUILD permission
      
      let permissionText = "一般";
      if (hasAdmin) {
        permissionText = "管理者";
      } else if (hasManageGuild) {
        permissionText = "サーバー管理";
      }

      // メンバー数（概算値、正確な値はさらにAPI呼び出しが必要）
      const memberCount = guild.approximate_member_count 
        ? guild.approximate_member_count.toLocaleString()
        : "不明";

      console.log(
        `│ ${name.padEnd(39)} │ ${guild.id.padEnd(20)} │ ${memberCount.padEnd(10)} │ ${permissionText.padEnd(12)} │`
      );
    }

    console.log("└─────────────────────────────────────────┴──────────────────────┴────────────┴──────────────┘");
    
    // 詳細情報
    console.log("\n📊 詳細情報:");
    const adminGuilds = guilds.filter(g => (parseInt(g.permissions) & 0x8) === 0x8);
    const manageGuilds = guilds.filter(g => (parseInt(g.permissions) & 0x20) === 0x20 && (parseInt(g.permissions) & 0x8) !== 0x8);
    
    console.log(`   • 管理者権限を持つサーバー: ${adminGuilds.length} 個`);
    console.log(`   • サーバー管理権限を持つサーバー: ${manageGuilds.length} 個`);
    console.log(`   • 一般権限のサーバー: ${guilds.length - adminGuilds.length - manageGuilds.length} 個`);

    // 設定済みサーバーの確認（環境変数が利用可能な場合）
    if (process.env.CLOUDFLARE_API_TOKEN) {
      console.log("\n🔧 勤怠管理設定済みサーバーを確認中...");
      await checkConfiguredGuilds(guilds);
    } else {
      console.log("\n💡 勤怠管理設定済みサーバーを確認するには、Cloudflare Workers環境変数が必要です");
    }

  } catch (error) {
    console.error("❌ エラーが発生しました:", error.message);
    process.exit(1);
  }
}

async function checkConfiguredGuilds(guilds) {
  // この機能は実際のKVストレージアクセスが必要なため、
  // 現在は基本的な情報のみ表示
  console.log("   （KVストレージアクセスが必要なため、詳細確認はスキップされました）");
  console.log("   詳細な設定状況は Discord で `/config` コマンドを使用して確認してください");
}

// 使用方法の表示
function showUsage() {
  console.log("📖 使用方法:");
  console.log("   bun run scripts/list-guilds.js");
  console.log("");
  console.log("📋 必要な環境変数:");
  console.log("   DISCORD_TOKEN - Discord Bot のトークン");
  console.log("   （または DISCORD_BOT_TOKEN）");
  console.log("");
  console.log("💡 例:");
  console.log("   export DISCORD_TOKEN=your_bot_token_here");
  console.log("   bun run scripts/list-guilds.js");
}

// ヘルプオプションのチェック
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  showUsage();
  process.exit(0);
}

// メイン実行
listGuilds();
