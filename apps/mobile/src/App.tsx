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
import type { RouteContribution, SettingsContribution } from '@BBeBee/protocol'
import { boot } from './boot'

/** What the tab bar can navigate to: a route, or a settings page. */
interface Tab {
  id: string
  title: string
}

/**
 * Re-read the registry whenever a plugin contributes or unloads.
 *
 * ⚠️ **Settings pages are navigable, not just routes.** `ctx.ui.settings` was
 * contributed by `plugin-local-scanner` and `plugin-sources` from the start
 * and read by nobody, so "Music folders" — the screen with *Add folder* and
 * *Scan now* on it — existed, had a view registered, and could not be reached
 * from either shell. A contribution nothing renders is a feature nobody has.
 */
function useTabs(ctx: Context): Tab[] {
  const read = () => ({
    routes: [...ctx.ui.routes] as readonly RouteContribution[],
    settings: [...ctx.ui.settings] as readonly SettingsContribution[],
  })
  const [state, setState] = useState(read)
  useEffect(() => {
    // `read` is redefined per render but only ever closes over `ctx`, so
    // re-subscribing on `ctx` alone is correct and keeps one listener.
    const off = ctx.on('ui/changed', () =>
      setState({ routes: [...ctx.ui.routes], settings: [...ctx.ui.settings] }),
    )
    return () => void off()
  }, [ctx])

  return [
    ...state.routes
      .filter((r) => r.placement?.includes('tab-bar') ?? true)
      .map((r) => ({ id: r.id, title: r.title })),
    /*
     * Settings pages that actually have a view.
     *
     * ⚠️ A different rule from routes, deliberately. A *route* with no view on
     * this target renders "not available on this platform", which is true and
     * worth saying. A settings page with no view on *either* target is not a
     * platform gap, it is a page nobody has written yet (`sources.settings` is
     * one today), and listing it advertises a screen that does not exist.
     */
    ...state.settings
      .filter((s) => ctx.ui.viewFor(s.id) !== undefined)
      .map((s) => ({ id: s.id, title: s.title })),
  ]
}

function Shell({ ctx }: { ctx: Context }) {
  const tabs = useTabs(ctx)
  const [activeId, setActiveId] = useState<string | undefined>()

  useEffect(() => {
    const off = ctx.on('ui/navigate', (routeId: string) => {
      setActiveId(routeId)
    })
    return () => void off()
  }, [ctx])

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0]
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
      ...tabs.map((tab) =>
        h(
          Pressable,
          {
            key: tab.id,
            onPress: () => setActiveId(tab.id),
            accessibilityRole: 'tab',
            accessibilityLabel: tab.title,
            accessibilityState: { selected: active?.id === tab.id },
            style: { flex: 1, padding: 14, alignItems: 'center' },
          },
          h(
            Text,
            {
              numberOfLines: 1,
              style: { color: active?.id === tab.id ? '#F5F5F7' : '#5A5A68' },
            },
            tab.title,
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
