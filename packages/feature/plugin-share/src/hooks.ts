import { useEffect, useState, useCallback } from "react"
import type { Context } from "cordis"
import type { ShareTarget } from "@BBeBee/protocol"

export interface ShareModalState {
  isOpen: boolean
  mode?: "share" | "import"
  target?: ShareTarget
  close: () => void
}

export function useShareModalState(ctx: Context): ShareModalState {
  const [state, setState] = useState<{
    isOpen: boolean
    mode?: "share" | "import"
    target?: ShareTarget
  }>({
    isOpen: false,
  })

  const close = useCallback(() => {
    setState({ isOpen: false, mode: undefined, target: undefined })
  }, [])

  useEffect(() => {
    const offOpen = ctx.on("share/open", (target: ShareTarget) => {
      setState({ isOpen: true, mode: "share", target })
    })

    const offImport = ctx.on("share/import", () => {
      setState({ isOpen: true, mode: "import", target: undefined })
    })

    return () => {
      offOpen()
      offImport()
    }
  }, [ctx])

  return {
    isOpen: state.isOpen,
    mode: state.mode,
    target: state.target,
    close,
  }
}
