import type { ParamSchema } from '@BBeBee/protocol'

export function createParamSchema<T>(defaultValues: T): ParamSchema<T> {
  return {
    '~standard': {
      version: 1,
      vendor: 'BBeBee',
      validate: (input: unknown) => {
        if (typeof input === 'object' && input !== null) {
          return { value: { ...(defaultValues as object), ...(input as object) } as T }
        }
        return { value: defaultValues }
      },
    },
  }
}
