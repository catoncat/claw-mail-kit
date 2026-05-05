import { HttpError } from './http';

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function keyFromSecret(secret: string): Promise<CryptoKey> {
  if (!secret || secret.length < 16) throw new HttpError(500, 'APP_ENCRYPTION_KEY is not configured');
  const digest = await crypto.subtle.digest('SHA-256', arrayBuffer(utf8(secret)));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptString(plainText: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFromSecret(secret);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: arrayBuffer(iv) }, key, arrayBuffer(utf8(plainText))));
  return `v1:${base64UrlEncode(iv)}:${base64UrlEncode(cipher)}`;
}

export async function decryptString(encrypted: string, secret: string): Promise<string> {
  const [version, ivText, cipherText] = encrypted.split(':');
  if (version !== 'v1' || !ivText || !cipherText) throw new HttpError(500, 'invalid encrypted setting format');
  const key = await keyFromSecret(secret);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: arrayBuffer(base64UrlDecode(ivText)) },
      key,
      arrayBuffer(base64UrlDecode(cipherText)),
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new HttpError(500, 'failed to decrypt setting');
  }
}

export function decodeBase64UrlJson<T>(value: string): T {
  const bytes = base64UrlDecode(value);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

export function base64UrlBytes(value: string): Uint8Array {
  return base64UrlDecode(value);
}
