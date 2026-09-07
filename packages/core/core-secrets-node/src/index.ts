/**
 * `ctx.secrets` for desktop and Node.
 *
 * Tokens live here and nowhere else (docs/04 §2). On the shipped desktop app
 * the backing store is Electron's `safeStorage`, which encrypts against the OS
 * keychain; that is injected as `config.crypto` so the same service runs under
 * test, in `main`, and in a headless build without any of them.
 *
 * ⚠️ **`isHardwareBacked` is false by default and that is not a detail.** With
 * no keychain the values are still encrypted, but with a key sitting on the
 * same disk — which stops a stray `cat` and stops nothing else. The flag exists
 * so the UI can say so rather than implying a guarantee the platform is not
 * making.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import { storageNamespace } from '@BBeBee/kernel'
import { base64Decode, base64Encode, sha256Hex } from '@BBeBee/protocol'
import type { SecretsService, Uri } from '@BBeBee/protocol'

/** Encrypt/decrypt for one platform. Electron supplies `safeStorage`. */
/**
 * Encrypt/decrypt for one platform.
 *
 * Async-tolerant because the real desktop codec is the OS keychain, which is
 * reachable only from Electron's main process — so every call is IPC. A
 * synchronous-only interface would have forced the keychain to be wrapped in
 * something that pretended to be synchronous, which is how it ends up not
 * being used at all.
 */
export interface SecretCrypto {
  encrypt(plain: string): string | Promise<string>
  decrypt(cipher: string): string | Promise<string>
  readonly isHardwareBacked: boolean
}

export interface SecretsNodeConfig {
  /** Defaults to an obfuscating codec that is honest about not being a keychain. */
  crypto?: SecretCrypto
  /** File under the data directory. One file, not one per secret. */
  fileName?: string
}

/**
 * The fallback codec.
 *
 * XOR against a key derived from the install, base64 for storage. It is
 * **obfuscation, not protection**, and `isHardwareBacked` is false so nothing
 * downstream can mistake it for more. A real implementation is one line of
 * config away (`crypto: safeStorage`), which is the point of the seam.
 */
class NoKeychainCodec implements SecretCrypto {
  readonly isHardwareBacked = false
  constructor(private readonly key: string) {}

  /**
   * ⚠️ The tag is not decoration.
   *
   * XOR "decrypts" anything into something — a corrupted or foreign value
   * comes back as plausible-looking mojibake, and the caller then sends *that*
   * as a token. The failure is a login that fails for no visible reason, on a
   * value the store reported as present. Prefixing a digest of the plaintext
   * makes corruption detectable, so `get` can return absent and the user is
   * asked to sign in again.
   */
  encrypt(plain: string): string {
    return base64Encode(xor(`${tag(plain)}:${plain}`, this.key))
  }

  decrypt(cipher: string): string {
    const plain = xor(base64Decode(cipher), this.key)
    const separator = plain.indexOf(':')
    if (separator !== TAG_LENGTH) throw new Error('secrets: value is not one this install wrote')
    const body = plain.slice(separator + 1)
    if (tag(body) !== plain.slice(0, TAG_LENGTH)) {
      throw new Error('secrets: value failed its integrity check')
    }
    return body
  }
}

const TAG_LENGTH = 8

function tag(plain: string): string {
  return sha256Hex(plain).slice(0, TAG_LENGTH)
}

function xor(value: string, key: string): string {
  let out = ''
  for (let i = 0; i < value.length; i++) {
    out += String.fromCharCode(value.charCodeAt(i) ^ key.charCodeAt(i % key.length))
  }
  return out
}

/**
 * The maximum value this backend accepts.
 *
 * Deliberately the *same* 2048 bytes `expo-secure-store` enforces, even though
 * a file has no such limit. A cookie jar that fits on desktop and silently
 * fails to save on a phone is the kind of divergence the conformance suites
 * exist to prevent — so the tighter platform sets the contract, and a caller
 * that needs more envelope-encrypts, exactly as docs/04 §2.1 says.
 */
const MAX_VALUE_BYTES = 2048

export class SecretsNode extends Service implements SecretsService {
  static inject = ['fs', 'paths']

  readonly maxValueBytes = MAX_VALUE_BYTES

  private codec!: SecretCrypto
  private entries = new Map<string, string>()
  /**
   * This service's **own** context, captured at construction.
   *
   * ⚠️ Not `this.ctx`. Inside a method reached through the service proxy,
   * `this.ctx` is the *caller's* context — that is how the capability gate
   * sees the caller's grants at all — so persisting through it would put the
   * store's own file in the caller's `fs` budget, and a plugin holding
   * `secrets:own` but not `fs:write:all` could not save a secret.
   *
   * The previous answer to that was to open the file with `node:fs` directly.
   * It kept the budget right and made this service **unloadable in the
   * Electron renderer**, which is sandboxed and has no Node — so the desktop
   * build could not even bundle, let alone run. The context handed to the
   * constructor is the service's own, ungated one (the constructor and
   * `Service.init` see the same object; a called method does not), so reading
   * `home.fs` gets the budget the platform API was reached for *and* keeps
   * this package to `ctx.*`, which is what lets it run wherever it is put.
   */
  private readonly home: Context
  /** The store's own file, as a Uri — `ctx.fs` speaks Uris, not paths. */
  private file: Uri | undefined
  /** Serialises writes: two `set`s racing would lose one of them. */
  private queue: Promise<void> = Promise.resolve()

  constructor(
    ctx: Context,
    private readonly config: SecretsNodeConfig = {},
  ) {
    super(ctx, 'secrets')
    this.home = ctx
  }

  get isHardwareBacked(): boolean {
    return this.codec.isHardwareBacked
  }

  async [Service.init]() {
    // `dir()` is a lookup rather than an access, so it is not gated — and it
    // is the one thing only `ctx.fs` knows.
    const dir = await this.home.fs.dir('data')
    if (dir) this.file = this.home.fs.join(dir, this.config.fileName ?? 'secrets.json')

    this.codec = this.config.crypto ?? new NoKeychainCodec(this.installKey())
    await this.load()
  }

  /**
   * The prefix a gated caller is confined to.
   *
   * ⚠️ Without this, `secrets:own` and `secrets:all` were the same grant: the
   * store read the intercept config for nothing, so any plugin holding
   * `ctx.secrets` could read and overwrite every other plugin's credentials by
   * naming their key. `storageNamespace` is the same scope id `ctx.store` and
   * the cookie jar use, so one plugin has one namespace across all three.
   *
   * An ungated caller — the kernel, a core service, a test — gets no prefix
   * and sees the whole store, which is what makes `clear()` on the root work.
   */
  private scope(): string {
    const ns = storageNamespace(this[Service.resolveConfig]())
    return ns ? `${ns}/` : ''
  }

  async get(key: string): Promise<string | undefined> {
    const stored = this.entries.get(this.scope() + key)
    if (stored === undefined) return undefined
    try {
      return await this.codec.decrypt(stored)
    } catch {
      /*
       * A value that will not decrypt is one the *platform* can no longer
       * read — a restored backup on another machine, a rotated keychain
       * entry. Treating it as absent asks the user to sign in again, which is
       * recoverable; throwing would make every read of that namespace fail
       * for ever with no way back.
       */
      return undefined
    }
  }

  async set(key: string, value: string): Promise<void> {
    const bytes = new TextEncoder().encode(value).length
    if (bytes > this.maxValueBytes) {
      throw new Error(
        `secrets: ${bytes} bytes exceeds the ${this.maxValueBytes}-byte limit — ` +
          'envelope-encrypt large values with a key kept here (docs/04 §2.1)',
      )
    }
    this.entries.set(this.scope() + key, await this.codec.encrypt(value))
    await this.flush()
  }

  async delete(key: string): Promise<void> {
    if (!this.entries.delete(this.scope() + key)) return
    await this.flush()
  }

  async clear(): Promise<void> {
    // The root namespace clears everything; a namespace — whether from
    // `namespace()` or from the caller's own scope — clears only its prefix,
    // which is what `signOut()` relies on.
    const prefix = this.scope()
    if (!prefix) {
      this.entries.clear()
    } else {
      for (const key of [...this.entries.keys()]) {
        if (key.startsWith(prefix)) this.entries.delete(key)
      }
    }
    await this.flush()
  }

  namespace(ns: string): SecretsService {
    return new NamespacedSecrets(this, `${ns}:`)
  }

  /* ── internals, reachable from a namespace ──────────────────────────── */

  /** @internal */
  keys(): string[] {
    return [...this.entries.keys()]
  }

  /** @internal */
  async deleteMany(prefix: string): Promise<void> {
    let changed = false
    const full = this.scope() + prefix
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(full)) {
        this.entries.delete(key)
        changed = true
      }
    }
    if (changed) await this.flush()
  }

  private async load(): Promise<void> {
    if (!this.file) return
    try {
      const text = await this.home.fs.readFile(this.file)
      const parsed: unknown = JSON.parse(text)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === 'string') this.entries.set(key, value)
        }
      }
    } catch {
      // No file yet, or an unreadable one. Starting empty means "sign in
      // again", which beats refusing to start.
    }
  }

  private flush(): Promise<void> {
    if (!this.file) return Promise.resolve()
    const location = this.file
    // Chained rather than concurrent: two writes racing would interleave and
    // one would win with a stale snapshot of the map.
    this.queue = this.queue.then(async () => {
      const body = JSON.stringify(Object.fromEntries(this.entries))
      await this.home.fs.writeFile(location, body)
    })
    return this.queue
  }

  /**
   * A per-install key for the fallback codec.
   *
   * Derived from the data directory's path, so a copied profile decrypts and a
   * file lifted on its own does not. That is a low bar, and the low bar is why
   * `isHardwareBacked` is false.
   */
  private installKey(): string {
    return `BBeBee:${this.file ?? 'memory'}`
  }
}

/**
 * A prefixed view.
 *
 * `clear()` on one removes only its own keys — that is what makes signing out
 * of one source leave every other source signed in.
 */
class NamespacedSecrets implements SecretsService {
  constructor(
    private readonly root: SecretsNode,
    private readonly prefix: string,
  ) {}

  get isHardwareBacked(): boolean {
    return this.root.isHardwareBacked
  }

  get maxValueBytes(): number {
    return this.root.maxValueBytes
  }

  get(key: string): Promise<string | undefined> {
    return this.root.get(this.prefix + key)
  }

  set(key: string, value: string): Promise<void> {
    return this.root.set(this.prefix + key, value)
  }

  delete(key: string): Promise<void> {
    return this.root.delete(this.prefix + key)
  }

  clear(): Promise<void> {
    return this.root.deleteMany(this.prefix)
  }

  namespace(ns: string): SecretsService {
    return new NamespacedSecrets(this.root, `${this.prefix}${ns}:`)
  }
}

export default SecretsNode
