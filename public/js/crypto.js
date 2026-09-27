/**
 * End-to-End Cryptography Engine (Zero-Knowledge, Client-Side Only)
 * Uses standard Web Crypto API (SubtleCrypto)
 * - Algorithm: AES-256-GCM (Authenticated Encryption with Associated Data)
 * - Key Derivation: PBKDF2 with SHA-256, 100,000 iterations
 * - Safety Fingerprint: SHA-256 visual checksum with emojis & digit blocks
 */

class DuoCrypto {
  constructor() {
    this.cryptoKey = null;
    this.keyFingerprint = null;
    this.passphrase = null;
  }

  /**
   * Generates a cryptographically strong random token for URL hash sharing
   */
  static generateRandomSecret() {
    const array = new Uint8Array(24);
    window.crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Initializes the AES-256-GCM key from a shared secret or passphrase
   * @param {string} passphrase The room key / passphrase
   * @param {string} saltSalt custom or standard salt
   */
  async initKey(passphrase, customSalt = 'p2p-duo-salt-2026') {
    this.passphrase = passphrase;
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
      'raw',
      enc.encode(passphrase),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    const saltBuffer = enc.encode(customSalt);

    this.cryptoKey = await window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: saltBuffer,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );

    // Generate Safety Code / Fingerprint for verification
    await this.generateFingerprint(passphrase);
    return this.keyFingerprint;
  }

  /**
   * Computes a verifiable safety code (Emoji set + 12-digit code)
   */
  async generateFingerprint(passphrase) {
    const enc = new TextEncoder();
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', enc.encode(passphrase));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    
    // 12-digit grouped code
    const digits = hashArray.slice(0, 6).map(b => (b % 100).toString().padStart(2, '0')).join('');
    const formattedDigits = `${digits.slice(0, 4)} ${digits.slice(4, 8)} ${digits.slice(8, 12)}`;

    // 4 Emojis derived from hash
    const emojiSet = ['🔒', '🛡️', '⚡', '🔑', '💎', '🚀', '🌟', '🌊', '🌲', '🦊', '🦅', '🦁', '🍀', '🔥', '🪐', '🔮'];
    const emojis = [
      emojiSet[hashArray[6] % emojiSet.length],
      emojiSet[hashArray[7] % emojiSet.length],
      emojiSet[hashArray[8] % emojiSet.length],
      emojiSet[hashArray[9] % emojiSet.length]
    ].join(' ');

    this.keyFingerprint = {
      digits: formattedDigits,
      emojis: emojis,
      fullHex: hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
    };
    return this.keyFingerprint;
  }

  /**
   * Encrypts a plaintext message using AES-256-GCM with a fresh random 12-byte IV
   * @param {string} text Plaintext string
   * @returns {object} { iv: base64, ciphertext: base64 }
   */
  async encryptText(text) {
    if (!this.cryptoKey) throw new Error('Crypto key not initialized');

    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const encodedText = enc.encode(text);

    const ciphertextBuffer = await window.crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv
      },
      this.cryptoKey,
      encodedText
    );

    return {
      iv: this.arrayBufferToBase64(iv),
      ciphertext: this.arrayBufferToBase64(ciphertextBuffer),
      timestamp: Date.now()
    };
  }

  /**
   * Decrypts an encrypted message package
   * @param {object} payload { iv: base64, ciphertext: base64 }
   * @returns {string} Plaintext string
   */
  async decryptText(payload) {
    if (!this.cryptoKey) throw new Error('Crypto key not initialized');

    const iv = this.base64ToArrayBuffer(payload.iv);
    const ciphertext = this.base64ToArrayBuffer(payload.ciphertext);

    const decryptedBuffer = await window.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: new Uint8Array(iv)
      },
      this.cryptoKey,
      ciphertext
    );

    const dec = new TextDecoder();
    return dec.decode(decryptedBuffer);
  }

  /**
   * Encrypts a binary chunk (file)
   */
  async encryptBinary(arrayBuffer) {
    if (!this.cryptoKey) throw new Error('Crypto key not initialized');
    const iv = window.crypto.getRandomValues(new Uint8Array(12));

    const encryptedBuffer = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      this.cryptoKey,
      arrayBuffer
    );

    return {
      iv: this.arrayBufferToBase64(iv),
      data: this.arrayBufferToBase64(encryptedBuffer)
    };
  }

  /**
   * Decrypts a binary chunk
   */
  async decryptBinary(payload) {
    if (!this.cryptoKey) throw new Error('Crypto key not initialized');
    const iv = this.base64ToArrayBuffer(payload.iv);
    const encryptedData = this.base64ToArrayBuffer(payload.data);

    return await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(iv) },
      this.cryptoKey,
      encryptedData
    );
  }

  arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  base64ToArrayBuffer(base64) {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }
}

window.DuoCrypto = DuoCrypto;
