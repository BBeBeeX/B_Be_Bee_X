import type { PixelBuffer } from "@BBeBee/protocol"

const MAGIC = new Uint8Array([0x42, 0x42, 0x65, 0x42, 0x65, 0x65]) // "BBeBee"
const VERSION = 1

/**
 * Encodes a string payload into an RGBA pixel buffer using LSB steganography.
 *
 * Header layout:
 * - 6 bytes: Magic string "BBeBee"
 * - 1 byte:  Version (1)
 * - 4 bytes: Payload byte length (uint32 big-endian)
 * - N bytes: UTF-8 payload bytes
 *
 * Bits are written to the least significant bit (bit 0) of the R, G, and B
 * channels sequentially. Alpha channel is untouched to preserve opacity and
 * avoid premultiplication issues.
 */
export function encodeSteganography(buffer: PixelBuffer, payload: string): PixelBuffer {
  const encoder = new TextEncoder()
  const payloadBytes = encoder.encode(payload)
  const payloadLength = payloadBytes.length

  const headerLength = MAGIC.length + 1 + 4 // magic + version + 4-byte length
  const totalBytes = headerLength + payloadLength
  const totalBits = totalBytes * 8

  const availableBits = buffer.width * buffer.height * 3
  if (totalBits > availableBits) {
    throw new Error(
      `Image capacity too small for steganography: required ${totalBits} bits (${totalBytes} bytes), available ${availableBits} bits`
    )
  }

  // Construct binary stream
  const packet = new Uint8Array(totalBytes)
  packet.set(MAGIC, 0)
  packet[MAGIC.length] = VERSION

  // 32-bit big-endian length
  const lenOffset = MAGIC.length + 1
  packet[lenOffset] = (payloadLength >>> 24) & 0xff
  packet[lenOffset + 1] = (payloadLength >>> 16) & 0xff
  packet[lenOffset + 2] = (payloadLength >>> 8) & 0xff
  packet[lenOffset + 3] = payloadLength & 0xff

  packet.set(payloadBytes, lenOffset + 4)

  // Clone buffer data so we do not mutate inputs in-place
  const data = new Uint8ClampedArray(buffer.data)

  // Write bits to R, G, B
  for (let bitIdx = 0; bitIdx < totalBits; bitIdx++) {
    const byteIdx = Math.floor(bitIdx / 8)
    const bitPos = 7 - (bitIdx % 8)
    const bit = (packet[byteIdx]! >>> bitPos) & 1

    const pixelIdx = Math.floor(bitIdx / 3)
    const channelIdx = bitIdx % 3 // 0=R, 1=G, 2=B
    const dataOffset = pixelIdx * 4 + channelIdx

    data[dataOffset] = (data[dataOffset]! & 0xfe) | bit
  }

  return {
    width: buffer.width,
    height: buffer.height,
    data,
  }
}

/**
 * Decodes a string payload from an RGBA pixel buffer.
 * Returns null if the magic header or structure does not match.
 */
export function decodeSteganography(buffer: PixelBuffer): string | null {
  const totalPixels = buffer.width * buffer.height
  const availableBits = totalPixels * 3
  const minRequiredBits = (MAGIC.length + 1 + 4) * 8

  if (availableBits < minRequiredBits) {
    return null
  }

  const data = buffer.data

  function readByte(byteOffset: number): number {
    let byteVal = 0
    const startBit = byteOffset * 8
    for (let i = 0; i < 8; i++) {
      const bitIdx = startBit + i
      const pixelIdx = Math.floor(bitIdx / 3)
      const channelIdx = bitIdx % 3
      const dataOffset = pixelIdx * 4 + channelIdx
      const bit = data[dataOffset]! & 1
      byteVal = (byteVal << 1) | bit
    }
    return byteVal
  }

  // 1. Check Magic Header
  for (let i = 0; i < MAGIC.length; i++) {
    if (readByte(i) !== MAGIC[i]) {
      return null
    }
  }

  // 2. Check Version
  const version = readByte(MAGIC.length)
  if (version !== VERSION) {
    return null
  }

  // 3. Read Payload Length (4 bytes big-endian)
  const lenOffset = MAGIC.length + 1
  const b0 = readByte(lenOffset)
  const b1 = readByte(lenOffset + 1)
  const b2 = readByte(lenOffset + 2)
  const b3 = readByte(lenOffset + 3)
  const payloadLength = ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0

  const totalBytesNeeded = MAGIC.length + 1 + 4 + payloadLength
  if (totalBytesNeeded * 8 > availableBits) {
    return null
  }

  // 4. Read Payload Bytes
  const payloadBytes = new Uint8Array(payloadLength)
  const payloadStartOffset = lenOffset + 4
  for (let i = 0; i < payloadLength; i++) {
    payloadBytes[i] = readByte(payloadStartOffset + i)
  }

  try {
    const decoder = new TextDecoder("utf-8", { fatal: true })
    return decoder.decode(payloadBytes)
  } catch {
    return null
  }
}
