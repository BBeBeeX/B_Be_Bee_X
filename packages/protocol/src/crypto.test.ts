/**
 * The digest primitives, against published vectors.
 *
 * Hand-written hashes are the archetypal code that looks right and is wrong:
 * a padding or endianness mistake produces stable, plausible output that fails
 * only against another implementation, and only for some inputs. So every
 * algorithm is checked against RFC vectors *and* against a length that crosses
 * a block boundary, which is where those mistakes live.
 */

import { createHash, createHmac, generateKeyPairSync, privateDecrypt, constants } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { base64Decode, base64Encode, hmacHex, md5Hex, randomHex, rsaEncrypt, rsaOaepEncrypt, sha1Hex } from './crypto.js'

describe('md5', () => {
  it('matches the RFC 1321 vectors', () => {
    expect(md5Hex('')).toBe('d41d8cd98f00b204e9800998ecf8427e')
    expect(md5Hex('a')).toBe('0cc175b9c0f1b6a831c399e269772661')
    expect(md5Hex('abc')).toBe('900150983cd24fb0d6963f7d28e17f72')
    expect(md5Hex('message digest')).toBe('f96b697d7cb7938d525a2f31aaf161d0')
    expect(md5Hex('abcdefghijklmnopqrstuvwxyz')).toBe('c3fcd3d76192e4007dfb496cca67e13b')
  })

  it('agrees with node across block boundaries', () => {
    // 55, 56, 64 and 119 are exactly where padding decides the answer.
    for (const length of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 1000]) {
      const input = 'x'.repeat(length)
      expect(md5Hex(input), `length ${length}`).toBe(createHash('md5').update(input).digest('hex'))
    }
  })

  it('hashes non-ASCII the way the bytes say', () => {
    expect(md5Hex('Björk')).toBe(createHash('md5').update('Björk').digest('hex'))
  })
})

describe('sha1', () => {
  it('matches the RFC 3174 vectors', () => {
    expect(sha1Hex('abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
    expect(sha1Hex('')).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709')
  })

  it('agrees with node across block boundaries', () => {
    for (const length of [0, 55, 56, 63, 64, 65, 119, 120, 1000]) {
      const input = 'y'.repeat(length)
      expect(sha1Hex(input), `length ${length}`).toBe(createHash('sha1').update(input).digest('hex'))
    }
  })
})

describe('hmac', () => {
  it('agrees with node for each algorithm', () => {
    // The outer pass hashes a *digest*, not its hex text. Getting that wrong
    // gives stable, plausible, entirely wrong output.
    for (const algorithm of ['md5', 'sha1', 'sha256'] as const) {
      expect(hmacHex(algorithm, 'key', 'The quick brown fox'), algorithm).toBe(
        createHmac(algorithm, 'key').update('The quick brown fox').digest('hex'),
      )
    }
  })

  it('handles a key longer than the block size', () => {
    // Over 64 bytes the key is hashed first — a branch nothing else exercises.
    const key = 'k'.repeat(200)
    expect(hmacHex('sha256', key, 'msg')).toBe(
      createHmac('sha256', key).update('msg').digest('hex'),
    )
  })
})

describe('base64', () => {
  it('round-trips, padding included', () => {
    for (const value of ['', 'a', 'ab', 'abc', 'abcd', 'Björk — Homogenic']) {
      expect(base64Decode(base64Encode(value)), value).toBe(value)
    }
  })

  it('agrees with the platform encoder', () => {
    for (const value of ['a', 'ab', 'abc', 'user:password']) {
      expect(base64Encode(value), value).toBe(Buffer.from(value, 'utf8').toString('base64'))
    }
  })
})

describe('randomHex', () => {
  it('returns the asked-for number of bytes', () => {
    expect(randomHex(8)).toHaveLength(16)
  })

  it('does not repeat', () => {
    // It seeds auth salts, where a predictable value is the vulnerability.
    const seen = new Set(Array.from({ length: 50 }, () => randomHex(8)))
    expect(seen.size).toBe(50)
  })

  it('is bounded, so a document cannot ask for a gigabyte', () => {
    expect(randomHex(10_000).length).toBeLessThanOrEqual(512)
  })
})

describe('base64url', () => {
  it('decodes the URL-safe alphabet rather than dropping it', () => {
    /*
     * ⚠️ A JWT and an OAuth token are base64url by definition. Stripping `-`
     * and `_` shifted every later character into the wrong quantum, so a token
     * decoded to something plausible and wrong — and only when it happened to
     * contain one, which made it look like a backend problem.
     */
    for (const raw of ['user:pa??word', 'a?b>c~d', '{"alg":"HS256","typ":"JWT"}']) {
      const url = Buffer.from(raw, 'utf8').toString('base64url')
      expect(base64Decode(url), url).toBe(raw)
    }
  })

  it('agrees with the platform decoder on a URL-safe token', () => {
    // The shape this exists for: a JWT header segment, which is base64url and
    // unpadded by definition.
    const token = Buffer.from('user:pa??word', 'utf8').toString('base64url')
    expect(token, 'the fixture really exercises the URL-safe alphabet').toMatch(/[-_]/)
    expect(base64Decode(token)).toBe(Buffer.from(token, 'base64url').toString('utf8'))
  })

  it('still decodes the standard alphabet', () => {
    expect(base64Decode(Buffer.from('user:password').toString('base64'))).toBe('user:password')
  })

  it('tolerates missing padding, which base64url omits', () => {
    expect(base64Decode('YWJj')).toBe('abc')
    expect(base64Decode('YWJjZA')).toBe('abcd')
  })

  it('refuses a length no encoder could have produced', () => {
    // 1 mod 4 is not a truncation to guess at — it is corruption, and half a
    // token silently decoded is worse than an error.
    expect(() => base64Decode('YWJjZA'.slice(0, 5))).toThrow(/base64/)
  })
})

describe('rsa and rsa-oaep', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 1024,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })

  it('encrypts with PKCS#1 v1.5 and decrypts successfully with node crypto', () => {
    const plain = 'test_password_hash_123456'
    const cipherB64 = rsaEncrypt(plain, publicKey)
    const decrypted = privateDecrypt(
      { key: privateKey, padding: constants.RSA_PKCS1_PADDING },
      Buffer.from(cipherB64, 'base64'),
    )
    expect(decrypted.toString('utf8')).toBe(plain)
  })

  it('encrypts with RSA-OAEP SHA-256 and decrypts successfully with node crypto', () => {
    const plain = 'refresh_1726000000000'
    const cipherHex = rsaOaepEncrypt(plain, publicKey)
    const decrypted = privateDecrypt(
      {
        key: privateKey,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      Buffer.from(cipherHex, 'hex'),
    )
    expect(decrypted.toString('utf8')).toBe(plain)
  })
})

