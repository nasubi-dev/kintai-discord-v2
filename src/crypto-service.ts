export class CryptoService {
  private encryptionKey: string;

  constructor(encryptionKey: string) {
    // 暗号化キーの検証を追加
    if (!encryptionKey || encryptionKey.length < 32) {
      throw new Error("暗号化キーは32文字以上である必要があります");
    }
    this.encryptionKey = encryptionKey;
  }

  /**
   * データを AES-GCM で暗号化
   * @param data 暗号化するデータ（任意の型）
   * @returns Base64エンコードされた暗号化データ
   */
  async encrypt(data: any): Promise<string> {
    try {
      const encoder = new TextEncoder();
      const dataString = typeof data === "string" ? data : JSON.stringify(data);
      const dataBuffer = encoder.encode(dataString);

      // 32バイトのキーを確実に作成
      const keyBuffer = encoder.encode(
        this.encryptionKey.slice(0, 32).padEnd(32, "0")
      );

      // Web Crypto API を使用した暗号化
      const key = await crypto.subtle.importKey(
        "raw",
        keyBuffer,
        { name: "AES-GCM" },
        false,
        ["encrypt"]
      );

      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        dataBuffer
      );

      // IV と暗号化データを結合
      const result = new Uint8Array(iv.length + encrypted.byteLength);
      result.set(iv);
      result.set(new Uint8Array(encrypted), iv.length);

      return btoa(String.fromCharCode(...result));
    } catch (error) {
      console.error("Encryption error:", error);
      throw new Error("暗号化に失敗しました");
    }
  }

  /**
   * AES-GCM で暗号化されたデータを復号化
   * @param encryptedData Base64エンコードされた暗号化データ
   * @returns 復号化されたデータ
   */
  async decrypt(encryptedData: string): Promise<any> {
    try {
      const encoder = new TextEncoder();
      const data = Uint8Array.from(atob(encryptedData), (c) => c.charCodeAt(0));

      // IV と暗号化データを分離
      const iv = data.slice(0, 12);
      const encryptedBuffer = data.slice(12);

      // 32バイトのキーを確実に作成
      const keyBuffer = encoder.encode(
        this.encryptionKey.slice(0, 32).padEnd(32, "0")
      );

      // 復号化キーをインポート
      const key = await crypto.subtle.importKey(
        "raw",
        keyBuffer,
        { name: "AES-GCM" },
        false,
        ["decrypt"]
      );

      // 復号化
      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        key,
        encryptedBuffer
      );

      const decoder = new TextDecoder();
      const decryptedString = decoder.decode(decrypted);

      // JSONとして解析を試行、失敗したら文字列として返す
      try {
        return JSON.parse(decryptedString);
      } catch {
        return decryptedString;
      }
    } catch (error) {
      console.error("Decryption error:", error);
      throw new Error("復号化に失敗しました");
    }
  }
}
