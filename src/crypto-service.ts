export class CryptoService {
  private encryptionKey: string;

  constructor(encryptionKey: string) {
    this.encryptionKey = encryptionKey;
  }

  async encrypt(data: any): Promise<string> {
    const encoder = new TextEncoder();
    const dataString = JSON.stringify(data);
    const dataBuffer = encoder.encode(dataString);

    // Web Crypto API を使用した暗号化
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(this.encryptionKey.slice(0, 32)), // 32文字に制限
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    );

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      dataBuffer
    );

    // IV と暗号化データを結合
    const result = new Uint8Array(iv.length + encrypted.byteLength);
    result.set(iv);
    result.set(new Uint8Array(encrypted), iv.length);

    return btoa(String.fromCharCode(...result));
  }

  async decrypt(encryptedData: string): Promise<any> {
    try {
      const encoder = new TextEncoder();
      const data = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));

      // IV と暗号化データを分離
      const iv = data.slice(0, 12);
      const encryptedBuffer = data.slice(12);

      // 復号化キーをインポート
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(this.encryptionKey.slice(0, 32)), // 32文字に制限
        { name: 'AES-GCM' },
        false,
        ['decrypt']
      );

      // 復号化
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        encryptedBuffer
      );

      const decoder = new TextDecoder();
      const decryptedString = decoder.decode(decrypted);
      return JSON.parse(decryptedString);
    } catch (error) {
      console.error('Decryption error:', error);
      throw new Error('復号化に失敗しました');
    }
  }
}
