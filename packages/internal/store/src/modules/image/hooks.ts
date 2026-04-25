import { useCallback } from "react"

import { type ImageStore, useImagesStore } from "./store"

export const useImageColors = (url?: string | null) => {
  return useImagesStore(
    useCallback(
      (state: ImageStore) => {
        if (!url) {
          return
        }
        return state.images[url]?.colors
      },
      [url],
    ),
  )
}
