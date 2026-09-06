/**
 * The mobile shell.
 *
 * Reads the same contributed routes as the desktop shell and renders them as a
 * tab bar. No feature knowledge here either.
 */

import { createElement as h, useEffect, useState, type ComponentType } from 'react'
import { ScrollView, Text, View, Pressable, ActivityIndicator } from 'react-native'
/*
 * ⚠️ `react-native-safe-area-context`, not React Native's own `SafeAreaView`.
 *
 * RN's is deprecated and warns on every launch: "SafeAreaView has been
 * deprecated and will be removed in a future release." It also only ever
 * worked on iOS, so the Android notch was never accounted for.
 *
 * This is a native module, so it needs a dev-client rebuild — which docs/11
 * §4.13 already expects for M1, and which FlashList requires anyway.
 */
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import type { Context } from 'cordis'
import type { RouteContribution } from '@BBeBee/protocol'
import { boot } from './boot'

function useRoutes(ctx: Context): readonly RouteContribution[] {
  const [routes, setRoutes] = useState<readonly RouteContribution[]>(() => ctx.ui.routes)
  useEffect(() => {
    const off = ctx.on('ui/changed', () => setRoutes([...ctx.ui.routes]))
    return () => void off()
  }, [ctx])
  return routes
}

function Shell({ ctx }: { ctx: Context }) {
  const routes = useRoutes(ctx)
  const [activeId, setActiveId] = useState<string | undefined>()
  const tabs = routes.filter((r) => r.placement?.includes('tab-bar') ?? true)
  const active = routes.find((r) => r.id === activeId) ?? tabs[0]
  const ViewComponent = active
    ? (ctx.ui.viewFor(active.id) as ComponentType<{ ctx: Context }> | undefined)
    : undefined

  return h(
    SafeAreaView,
    { style: { flex: 1, backgroundColor: '#0B0B0F' } },
    h(
      ScrollView,
      { style: { flex: 1 } },
      ViewComponent
        ? h(ViewComponent, { ctx })
        : h(
            Text,
            { style: { padding: 24, color: '#A0A0AE' } },
            active ? `"${active.title}" has no mobile view.` : 'No plugin has contributed a route.',
          ),
    ),
    h(
      View,
      { style: { flexDirection: 'row', borderTopColor: '#1E1E28', borderTopWidth: 1 } },
      ...tabs.map((route) =>
        h(
          Pressable,
          {
            key: route.id,
            onPress: () => setActiveId(route.id),
            style: { flex: 1, padding: 14, alignItems: 'center' },
          },
          h(
            Text,
            { style: { color: active?.id === route.id ? '#F5F5F7' : '#5A5A68' } },
            route.title,
          ),
        ),
      ),
    ),
  )
}

export default function App() {
  const [ctx, setCtx] = useState<Context>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    let disposed = false
    boot()
      .then((app) => app.ready(['ui'], { timeoutMs: 15_000 }))
      .then((ready) => { if (!disposed) setCtx(ready) })
      .catch((e: unknown) => setError(e instanceof Error ? (e.stack ?? e.message) : String(e)))
    return () => { disposed = true }
  }, [])

  if (error) {
    return h(
      SafeAreaView,
      { style: { flex: 1, backgroundColor: '#0B0B0F' } },
      h(Text, { style: { padding: 24, color: '#FF5C5C' } }, `BBeBee failed to start:\n\n${error}`),
    )
  }
  if (!ctx) {
    return h(
      SafeAreaView,
      { style: { flex: 1, backgroundColor: '#0B0B0F', justifyContent: 'center' } },
      h(ActivityIndicator, { color: '#7C5CFF' }),
    )
  }
  return h(Shell, { ctx })
}

/**
 * The root component: the safe-area provider, then the app.
 *
 * The provider has to be above every `SafeAreaView`, and `App` is the only
 * thing `registerRootComponent` mounts — so it goes here rather than in the
 * shell, where a second screen could forget it.
 */
export function Root() {
  return h(SafeAreaProvider, null, h(App))
}
