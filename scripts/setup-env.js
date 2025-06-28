#!/usr/bin/env node

/**
 * 環境変数設定支援スクリプト
 * Google OAuth認証情報を設定するためのガイド
 */

import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';

console.log('🔧 勤怠Discord Bot 環境変数設定');
console.log('================================');

// 現在の設定を読み込み
const envPath = path.join(process.cwd(), '.dev.vars');
let currentEnv = {};

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const [key, value] = line.split('=');
    if (key && value) {
      currentEnv[key] = value;
    }
  });
}

console.log('\n📋 現在の設定状況:');
console.log('==================');

// Discord 設定チェック
console.log('🤖 Discord Bot:');
console.log(`  APPLICATION_ID: ${currentEnv.DISCORD_APPLICATION_ID ? '✅ 設定済み' : '❌ 未設定'}`);
console.log(`  PUBLIC_KEY: ${currentEnv.DISCORD_PUBLIC_KEY ? '✅ 設定済み' : '❌ 未設定'}`);
console.log(`  TOKEN: ${currentEnv.DISCORD_TOKEN ? '✅ 設定済み' : '❌ 未設定'}`);

// Google OAuth 設定チェック
console.log('\n🔐 Google OAuth:');
const needsGoogleSetup = !currentEnv.GOOGLE_CLIENT_ID || 
                        currentEnv.GOOGLE_CLIENT_ID === 'your_google_client_id_here';
console.log(`  CLIENT_ID: ${needsGoogleSetup ? '❌ 要設定' : '✅ 設定済み'}`);
console.log(`  CLIENT_SECRET: ${needsGoogleSetup ? '❌ 要設定' : '✅ 設定済み'}`);
console.log(`  REDIRECT_URI: ${currentEnv.GOOGLE_REDIRECT_URI ? '✅ 設定済み' : '❌ 未設定'}`);

// 暗号化キー設定チェック
console.log('\n🔒 暗号化:');
const needsEncryptionKey = !currentEnv.ENCRYPTION_KEY || 
                          currentEnv.ENCRYPTION_KEY === 'your_32_character_encryption_key_here';
console.log(`  ENCRYPTION_KEY: ${needsEncryptionKey ? '❌ 要設定' : '✅ 設定済み'}`);

// 設定が必要な項目がある場合のガイド
if (needsGoogleSetup || needsEncryptionKey) {
  console.log('\n🛠️  設定が必要な項目があります');
  console.log('=====================================');
  
  if (needsEncryptionKey) {
    console.log('\n🔒 暗号化キーの生成:');
    const encryptionKey = randomBytes(16).toString('hex'); // 32文字のhex文字列
    console.log(`   新しい暗号化キー: ${encryptionKey}`);
    console.log('   ↑ この値を ENCRYPTION_KEY に設定してください');
  }
  
  if (needsGoogleSetup) {
    console.log('\n🔐 Google OAuth 設定手順:');
    console.log('1. Google Cloud Console (https://console.cloud.google.com/) にアクセス');
    console.log('2. プロジェクトを作成/選択');
    console.log('3. Google Sheets API を有効化');
    console.log('4. 認証情報 → OAuth クライアント ID を作成');
    console.log('5. ウェブアプリケーション を選択');
    console.log('6. リダイレクト URI に以下を追加:');
    console.log(`   ${currentEnv.GOOGLE_REDIRECT_URI || 'https://kintai-discord.nasubi.dev/oauth/callback'}`);
    console.log('7. クライアント ID と クライアント シークレット を .dev.vars に設定');
  }
} else {
  console.log('\n✅ すべての設定が完了しています！');
  console.log('   `bun run deploy` でデプロイできます。');
}

console.log('\n📝 設定ファイル: .dev.vars');
console.log('💡 設定後は `bun run deploy` でデプロイしてください。');
