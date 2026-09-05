/**
 * `ctx.secrets` — the conformance suite.
 *
 * The behaviours here are the ones a credential store gets *quietly* wrong,
 * and each of them shows up much later as a support request rather than as a
 * failure:
 *
 *  - a namespace whose `clear()` takes another namespace's tokens with it, so
 *    signing out of one source signs out of all of them;
 *  - a value that comes back subtly different, so a token stops matching for
 *    no visible reason;
 *  - a size limit that one platform enforces and another does not, so the
 *    cookie jar that works on desktop silently never saves on a phone.
 *
 * See docs/04-core-services.md §2.
 */

import type { SecretsService } from '../services/storage.js'
import { assert, assertEqual, assertRejects, type ConformanceSuite } from './harness.js'

export interface SecretsSubject {
  secrets: SecretsService
}

export const secretsConformance: ConformanceSuite<SecretsSubject> = {
  service: 'secrets',
  checks: [
    {
      name: 'round-trips a value exactly',
      because: 'a token that comes back altered stops matching, with nothing to say why',
      async run({ secrets }) {
        for (const value of ['abc', '', 'a b&c=d', 'Björk — Homogenic', '{"json":true}']) {
          await secrets.set('k', value)
          assertEqual(await secrets.get('k'), value, `round trip of ${JSON.stringify(value)}`)
        }
        await secrets.delete('k')
      },
    },

    {
      name: 'returns undefined for a key that was never set',
      because: 'absent and empty are different, and a caller branches on it',
      async run({ secrets }) {
        assertEqual(await secrets.get('never-set'), undefined, 'missing key')
      },
    },

    {
      name: 'distinguishes an empty string from an absent key',
      because: 'a stored empty value means "signed in with no token", not "signed out"',
      async run({ secrets }) {
        await secrets.set('empty', '')
        assertEqual(await secrets.get('empty'), '', 'stored empty string')
        await secrets.delete('empty')
        assertEqual(await secrets.get('empty'), undefined, 'after delete')
      },
    },

    {
      name: 'overwrites rather than appending',
      because: 'a refreshed token replacing an expired one is the common write',
      async run({ secrets }) {
        await secrets.set('k', 'first')
        await secrets.set('k', 'second')
        assertEqual(await secrets.get('k'), 'second', 'latest wins')
        await secrets.delete('k')
      },
    },

    {
      name: 'deleting a key that is not there is not an error',
      because: 'sign-out runs over a list that may already be partly gone',
      async run({ secrets }) {
        await secrets.delete('never-set')
      },
    },

    {
      name: 'namespaces do not see each other',
      because: 'two imported sources must not be able to read each other’s credentials',
      async run({ secrets }) {
        const a = secrets.namespace('source-a')
        const b = secrets.namespace('source-b')
        await a.set('token', 'a-token')
        await b.set('token', 'b-token')

        assertEqual(await a.get('token'), 'a-token', 'a keeps its own')
        assertEqual(await b.get('token'), 'b-token', 'b keeps its own')
        await a.clear()
        await b.clear()
      },
    },

    {
      name: 'clearing one namespace leaves the others alone',
      because:
        'this *is* sign-out; getting it wrong signs the user out of every source they have',
      async run({ secrets }) {
        const a = secrets.namespace('source-a')
        const b = secrets.namespace('source-b')
        await a.set('token', 'a-token')
        await b.set('token', 'b-token')

        await a.clear()
        assertEqual(await a.get('token'), undefined, 'a is empty')
        assertEqual(await b.get('token'), 'b-token', 'b is untouched')
        await b.clear()
      },
    },

    {
      name: 'nests namespaces',
      because: 'a source’s cookie jar and its vars are two namespaces under one source',
      async run({ secrets }) {
        const source = secrets.namespace('source-a')
        const jar = source.namespace('jar')
        await jar.set('cookies', 'x')
        assertEqual(await jar.get('cookies'), 'x', 'nested read')

        // Clearing the parent clears the child: sign-out is one call.
        await source.clear()
        assertEqual(await jar.get('cookies'), undefined, 'the child went with it')
      },
    },

    {
      name: 'reports a value-size limit and enforces it',
      because:
        'the tighter platform sets the contract — a jar that saves on desktop and silently does not on a phone is the divergence these suites exist to catch',
      async run({ secrets }) {
        assert(secrets.maxValueBytes > 0, 'a limit is reported')
        await assertRejects(
          () => secrets.set('big', 'x'.repeat(secrets.maxValueBytes + 1)),
          'an oversized value is refused rather than truncated',
          /limit|size|bytes/i,
        )
      },
    },

    {
      name: 'accepts the key characters a namespaced caller produces',
      because:
        'a backend that silently rejects a key shape its own namespacing generates stores nothing, and reports success doing it',
      async run({ secrets }) {
        // `namespace()` composes ids, and a source id contains dashes. A store
        // whose backend refuses the resulting key persists nothing — measured
        // on SecureStore, which rejects `:`.
        /*
         * ⚠️ Measured on SecureStore, which throws on any key outside
         * `[A-Za-z0-9._-]`: a `:` separator made every namespaced write on
         * mobile fail, which is every credential and every cookie jar. Nothing
         * surfaced it, because a jar that never saves reads back empty and
         * looks exactly like a user who has not signed in.
         */
        const nested = secrets.namespace('music-example-org-35be9fe2').namespace('jar')
        await nested.set('cookies-v1', 'x')
        assertEqual(await nested.get('cookies-v1'), 'x', 'a composed key round-trips')

        // And two ways of composing the same text must not collide.
        const a = secrets.namespace('a.b')
        const b = secrets.namespace('a').namespace('b')
        await a.set('k', 'from-a.b')
        await b.set('k', 'from-a-then-b')
        assertEqual(await a.get('k'), 'from-a.b', 'the two namespaces stay distinct')

        await nested.clear()
        await a.clear()
        await b.clear()
      },
    },

    {
      name: 'says whether it is hardware-backed',
      because:
        'without a keychain the value is obfuscated, not protected, and the UI must be able to say so',
      async run({ secrets }) {
        assert(typeof secrets.isHardwareBacked === 'boolean', 'the flag is present')
      },
    },
  ],
}
