import type { EncryptedPluginCredentialPayload } from "../schemas"

let encryptionSecret: string | undefined

export function setPluginCredentialEncryptionSecret(secret: string) {
  encryptionSecret = secret
}

function getCrypto() {
  const crypto = globalThis.crypto
  if (!crypto?.subtle) {
    throw new Error("Web Crypto API is required to encrypt plugin credentials")
  }
  return crypto
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return globalThis.btoa(binary)
}

function base64ToBytes(base64: string) {
  const binary = globalThis.atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

async function getEncryptionKey() {
  if (!encryptionSecret) {
    throw new Error("Plugin credential encryption secret has not been configured")
  }

  const crypto = getCrypto()
  const secretBytes = new TextEncoder().encode(encryptionSecret)
  const secretHash = await crypto.subtle.digest("SHA-256", secretBytes)
  return crypto.subtle.importKey("raw", secretHash, "AES-GCM", false, ["encrypt", "decrypt"])
}

export async function encryptPluginCredentialPayload<TPayload>(payload: TPayload) {
  const crypto = getCrypto()
  const key = await getEncryptionKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(JSON.stringify(payload))
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext)

  return {
    algorithm: "AES-GCM",
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(encrypted)),
  } satisfies EncryptedPluginCredentialPayload
}

export async function decryptPluginCredentialPayload<TPayload>(
  payload: EncryptedPluginCredentialPayload,
) {
  const key = await getEncryptionKey()
  const iv = base64ToBytes(payload.iv)
  const encrypted = base64ToBytes(payload.data)
  const decrypted = await getCrypto().subtle.decrypt({ name: payload.algorithm, iv }, key, encrypted)
  return JSON.parse(new TextDecoder().decode(decrypted)) as TPayload
}
