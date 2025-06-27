#!/usr/bin/env bun
/**
 * Cloudflare Workers シークレット設定スクリプト
 * .env ファイルの内容をCloudflare Workersのシークレットに設定します
 */

import { config } from "dotenv";
import { execSync } from "child_process";

// .env ファイルを読み込み
config();

const secrets = [
  "DISCORD_PUBLIC_KEY",
  "DISCORD_APPLICATION_ID",
  "DISCORD_TOKEN",
  "GAS_WEB_APP_URL",
  "ALLOWED_CHANNEL_IDS",
];

console.log("🔐 Setting up Cloudflare Workers secrets...");

for (const secret of secrets) {
  const value = process.env[secret];

  if (!value) {
    console.warn(`⚠️  ${secret} is not set in .env file, skipping...`);
    continue;
  }

  try {
    console.log(`Setting ${secret}...`);
    execSync(`echo "${value}" | bunx wrangler secret put ${secret}`, {
      stdio: ["pipe", "inherit", "inherit"],
    });
    console.log(`✅ ${secret} set successfully`);
  } catch (error) {
    console.error(`❌ Failed to set ${secret}:`, error.message);
  }
}

console.log("🎉 Secrets setup completed!");
