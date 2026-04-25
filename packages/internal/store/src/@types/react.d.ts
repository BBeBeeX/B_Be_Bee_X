declare module "react" {
  export function useCallback<T>(callback: T, deps: readonly unknown[]): T
}
