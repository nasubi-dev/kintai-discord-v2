export class CryptoService {
  private encryptionKey: string;

  constructor(encryptionKey: string) {
    if (!encryptionKey || encryptionKey.length < 32) {
      throw new Error("暗号化キーは32文字以上である必要があります");
    }
    this.encryptionKey = encryptionKey;
  }

  async encrypt(data: any): Promise<string> {
    const encoder = new TextEncoder();
    const dataString = typeof data === "string" ? data : JSON.stringify(data);
    const dataBuffer = encoder.encode(dataString);

    const keyBuffer = encoder.encode(
      this.encryptionKey.slice(0, 32).padEnd(32, "0")
    );
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

    const result = new Uint8Array(iv.length + encrypted.byteLength);
    result.set(iv);
    result.set(new Uint8Array(encrypted), iv.length);

    return btoa(String.fromCharCode(...result));
  }

  async decrypt(encryptedData: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = Uint8Array.from(atob(encryptedData), (c) => c.charCodeAt(0));
    const iv = data.slice(0, 12);
    const encryptedBuffer = data.slice(12);

    const keyBuffer = encoder.encode(
      this.encryptionKey.slice(0, 32).padEnd(32, "0")
    );
    const key = await crypto.subtle.importKey(
      "raw",
      keyBuffer,
      { name: "AES-GCM" },
      false,
      ["decrypt"]
    );
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      encryptedBuffer
    );

    const decoder = new TextDecoder();
    const decryptedString = decoder.decode(decrypted);

    // 常に文字列を返すように変更（オブジェクトの場合はJSONパースを呼び出し元で行う）
    return decryptedString;
  }
}
