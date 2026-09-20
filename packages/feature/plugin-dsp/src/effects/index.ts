export * from './preamp.js'
export * from './eq10.js'
export * from './normalize.js'
export * from './compressor.js'
export * from './reverb.js'
export * from './widener.js'
export * from './crossfeed.js'
export * from './tempo-pitch.js'
export * from './limiter.js'
export * from './schema.js'

import { PreampEffect } from './preamp.js'
import { Eq10Effect } from './eq10.js'
import { NormalizeEffect } from './normalize.js'
import { CompressorEffect } from './compressor.js'
import { ReverbEffect } from './reverb.js'
import { WidenerEffect } from './widener.js'
import { CrossfeedEffect } from './crossfeed.js'
import { TempoPitchEffect } from './tempo-pitch.js'
import { LimiterEffect } from './limiter.js'
import type { EffectDefinition } from '@BBeBee/protocol'

export const BUILTIN_EFFECTS: EffectDefinition<never>[] = [
  PreampEffect as unknown as EffectDefinition<never>,
  Eq10Effect as unknown as EffectDefinition<never>,
  NormalizeEffect as unknown as EffectDefinition<never>,
  CompressorEffect as unknown as EffectDefinition<never>,
  ReverbEffect as unknown as EffectDefinition<never>,
  WidenerEffect as unknown as EffectDefinition<never>,
  CrossfeedEffect as unknown as EffectDefinition<never>,
  TempoPitchEffect as unknown as EffectDefinition<never>,
  LimiterEffect as unknown as EffectDefinition<never>,
]
