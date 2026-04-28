export type ChecksumAlgorithm = "SHA-256" | "SHA-384" | "SHA-512"

const bytesToHex = (bytes: Uint8Array) => {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

export const computeChecksum = async (
  payload: string | ArrayBuffer,
  algorithm: ChecksumAlgorithm = "SHA-256",
) => {
  const data = typeof payload === "string" ? new TextEncoder().encode(payload) : payload
  const hash = await globalThis.crypto.subtle.digest(algorithm, data)
  return `${algorithm.toLowerCase()}:${bytesToHex(new Uint8Array(hash))}`
}

export const verifyChecksum = async (payload: string | ArrayBuffer, expected: string) => {
  const [rawAlgorithm] = expected.split(":")
  const algorithm = (rawAlgorithm?.toUpperCase() || "SHA-256") as ChecksumAlgorithm
  const actual = await computeChecksum(payload, algorithm)
  if (actual !== expected) {
    throw new Error("Plugin checksum verification failed.")
  }
  return actual
}
