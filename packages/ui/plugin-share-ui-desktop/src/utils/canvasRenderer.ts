import type {
  ShareAlbumData,
  ShareLyricsData,
  SharePlaylistData,
  ShareTrackData,
} from "@BBeBee/protocol"
import { encodeSteganography } from "@BBeBee/plugin-share/steganography"
import { encodeMetadata } from "@BBeBee/plugin-share/metadata"
import { BBEBEE_LOGO_DATA_URL } from "../assets/logo.js"

export type BackgroundMode = "cover" | "gradient" | "black"

export interface RenderTrackCardOptions {
  track: ShareTrackData
  themeColor: string
  backgroundMode: BackgroundMode
}

export interface RenderPlaylistCardOptions {
  playlist: SharePlaylistData
  themeColor: string
  backgroundMode: BackgroundMode
}

export interface RenderAlbumCardOptions {
  album: ShareAlbumData
  themeColor: string
  backgroundMode: BackgroundMode
}

export interface RenderLyricsCardOptions {
  lyrics: ShareLyricsData
  themeColor: string
  backgroundMode: BackgroundMode
}

/** Helper to safely load an image URL with CORS and fallback */
export function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) return resolve(null)
    const normalized = src.startsWith("file://") ? src.replace(/^file:\/\//, "bbebee-file://") : src
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.referrerPolicy = "no-referrer"
    img.onload = () => resolve(img)
    img.onerror = () => {
      // If CORS anonymous failed, try fetching as blob
      if (typeof fetch === "function" && (normalized.startsWith("http://") || normalized.startsWith("https://"))) {
        fetch(normalized, { referrerPolicy: "no-referrer" })
          .then((res) => {
            if (!res.ok) throw new Error("Fetch failed")
            return res.blob()
          })
          .then((blob) => {
            const blobUrl = URL.createObjectURL(blob)
            const blobImg = new Image()
            blobImg.onload = () => {
              URL.revokeObjectURL(blobUrl)
              resolve(blobImg)
            }
            blobImg.onerror = () => {
              URL.revokeObjectURL(blobUrl)
              resolve(null)
            }
            blobImg.src = blobUrl
          })
          .catch(() => {
            // As last fallback, load without crossOrigin
            const fallback = new Image()
            fallback.referrerPolicy = "no-referrer"
            fallback.onload = () => resolve(fallback)
            fallback.onerror = () => resolve(null)
            fallback.src = normalized
          })
      } else {
        resolve(null)
      }
    }
    img.src = normalized
  })
}

/** Draws a rounded rectangle path on 2D context */
export function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

/** Truncates text with ellipsis if it exceeds maxWidth */
function fillTruncatedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
) {
  let truncated = text
  if (ctx.measureText(truncated).width <= maxWidth) {
    ctx.fillText(truncated, x, y)
    return
  }
  while (truncated.length > 0 && ctx.measureText(truncated + "…").width > maxWidth) {
    truncated = truncated.slice(0, -1)
  }
  ctx.fillText(truncated + "…", x, y)
}

/**
 * Renders the background according to backgroundMode.
 * In gradient mode, the gradient transitions to black at half of the share content height.
 */
function renderBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  themeColor: string,
  mode: BackgroundMode,
  contentMidY = 480,
) {
  if (mode === "black") {
    ctx.fillStyle = "#000000"
    ctx.fillRect(0, 0, width, height)
  } else if (mode === "gradient") {
    const grad = ctx.createLinearGradient(0, 0, 0, contentMidY)
    grad.addColorStop(0, themeColor)
    grad.addColorStop(0.35, themeColor)
    grad.addColorStop(1, "#000000")
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, width, contentMidY)
    ctx.fillStyle = "#000000"
    ctx.fillRect(0, contentMidY, width, height - contentMidY)
  } else {
    // Solid cover theme color
    ctx.fillStyle = themeColor
    ctx.fillRect(0, 0, width, height)
  }
}

/**
 * Generates an HTMLCanvasElement with the rendered track share card
 * and embeds the Base64 metadata steganographically into its pixels.
 */
export async function generateTrackCardCanvas(
  options: RenderTrackCardOptions,
): Promise<HTMLCanvasElement> {
  const { track, themeColor, backgroundMode } = options
  const width = 540
  const height = 960

  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!

  // Floating Card dimensions (vertically centered, balanced 530px height)
  const cardW = 440
  const cardH = 530
  const cardX = (width - cardW) / 2
  const cardY = Math.round((height - cardH) / 2)
  const cardRadius = 24
  const contentMidY = Math.round(cardY + cardH * 0.5)

  // 1. Draw overall background (gradient to half of share content height)
  renderBackground(ctx, width, height, themeColor, backgroundMode, contentMidY)

  // Card background: pure black container
  ctx.save()
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)"
  ctx.shadowBlur = 40
  ctx.shadowOffsetY = 16
  ctx.fillStyle = "#000000"
  drawRoundRect(ctx, cardX, cardY, cardW, cardH, cardRadius)
  ctx.fill()
  ctx.restore()

  // Card Content (Cover, Title, Artist, Logo)
  const artW = 380
  const artH = 380
  const artX = cardX + (cardW - artW) / 2
  const artY = cardY + 24
  const artRadius = 16

  const coverImg = track.artwork ? await loadImage(track.artwork) : null
  ctx.save()
  drawRoundRect(ctx, artX, artY, artW, artH, artRadius)
  ctx.clip()
  if (coverImg) {
    ctx.drawImage(coverImg, artX, artY, artW, artH)
  } else {
    // Placeholder
    ctx.fillStyle = "#1e2230"
    ctx.fillRect(artX, artY, artW, artH)
    ctx.fillStyle = "rgba(255, 255, 255, 0.3)"
    ctx.font = "bold 64px sans-serif"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText("♪", artX + artW / 2, artY + artH / 2)
  }
  ctx.restore()

  // Song Title
  ctx.save()
  ctx.fillStyle = "#FFFFFF"
  ctx.font = "bold 22px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
  ctx.textAlign = "left"
  ctx.textBaseline = "top"
  const textX = artX
  const titleY = artY + artH + 18
  fillTruncatedText(ctx, track.title, textX, titleY, cardW - 60)

  // Artist
  ctx.fillStyle = "#B3B9C9"
  ctx.font = "500 15px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
  const artistY = titleY + 30
  fillTruncatedText(ctx, track.artist, textX, artistY, cardW - 60)
  ctx.restore()

  // Logo (140px, aligned to bottom-left with 20px bottom padding)
  const logoImg = await loadImage(BBEBEE_LOGO_DATA_URL)
  if (logoImg) {
    const logoW = 140
    const logoH = (logoW / logoImg.width) * logoImg.height
    const logoX = cardX + 26
    const logoY = cardY + cardH - logoH - 20
    ctx.drawImage(logoImg, logoX, logoY, logoW, logoH)
  }

  // 3. Steganography Embedding
  try {
    const b64Payload = encodeMetadata("track", track)
    const imgData = ctx.getImageData(0, 0, width, height)
    const encoded = encodeSteganography(imgData, b64Payload)
    imgData.data.set(encoded.data)
    ctx.putImageData(imgData, 0, 0)
  } catch (err) {
    throw new Error(`隐写数据嵌入失败: ${String(err)}`)
  }

  return canvas
}

/**
 * Generates an HTMLCanvasElement with the rendered playlist share card.
 */
export async function generatePlaylistCardCanvas(
  options: RenderPlaylistCardOptions,
): Promise<HTMLCanvasElement> {
  const { playlist, themeColor, backgroundMode } = options
  const width = 540
  const height = 960

  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!

  const cardW = 440
  const cardH = 530
  const cardX = (width - cardW) / 2
  const cardY = Math.round((height - cardH) / 2)
  const cardRadius = 24
  const contentMidY = Math.round(cardY + cardH * 0.5)

  renderBackground(ctx, width, height, themeColor, backgroundMode, contentMidY)

  // Card background: pure black container
  ctx.save()
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)"
  ctx.shadowBlur = 40
  ctx.shadowOffsetY = 16
  ctx.fillStyle = "#000000"
  drawRoundRect(ctx, cardX, cardY, cardW, cardH, cardRadius)
  ctx.fill()
  ctx.restore()

  const artW = 380
  const artH = 380
  const artX = cardX + (cardW - artW) / 2
  const artY = cardY + 24
  const artRadius = 16

  const coverImg = playlist.artwork ? await loadImage(playlist.artwork) : null
  ctx.save()
  drawRoundRect(ctx, artX, artY, artW, artH, artRadius)
  ctx.clip()
  if (coverImg) {
    ctx.drawImage(coverImg, artX, artY, artW, artH)
  } else {
    ctx.fillStyle = "#1e2230"
    ctx.fillRect(artX, artY, artW, artH)
    ctx.fillStyle = "rgba(255, 255, 255, 0.3)"
    ctx.font = "bold 64px sans-serif"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText("♫", artX + artW / 2, artY + artH / 2)
  }
  ctx.restore()

  // Playlist Name
  ctx.save()
  ctx.fillStyle = "#FFFFFF"
  ctx.font = "bold 22px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
  ctx.textAlign = "left"
  ctx.textBaseline = "top"
  const textX = artX
  const titleY = artY + artH + 18
  fillTruncatedText(ctx, playlist.name, textX, titleY, cardW - 60)

  // Subtitle / Track count
  ctx.fillStyle = "#B3B9C9"
  ctx.font = "500 15px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
  const artistY = titleY + 30
  const subtitle = playlist.trackCount > 0 ? `歌单 • ${playlist.trackCount} 首歌曲` : "歌单"
  fillTruncatedText(ctx, subtitle, textX, artistY, cardW - 60)
  ctx.restore()

  // Logo (140px, aligned to bottom-left with 20px bottom padding)
  const logoImg = await loadImage(BBEBEE_LOGO_DATA_URL)
  if (logoImg) {
    const logoW = 140
    const logoH = (logoW / logoImg.width) * logoImg.height
    const logoX = cardX + 26
    const logoY = cardY + cardH - logoH - 20
    ctx.drawImage(logoImg, logoX, logoY, logoW, logoH)
  }

  // Steganography
  try {
    const b64Payload = encodeMetadata("playlist", playlist)
    const imgData = ctx.getImageData(0, 0, width, height)
    const encoded = encodeSteganography(imgData, b64Payload)
    imgData.data.set(encoded.data)
    ctx.putImageData(imgData, 0, 0)
  } catch (err) {
    throw new Error(`隐写数据嵌入失败: ${String(err)}`)
  }

  return canvas
}

/**
 * Generates an HTMLCanvasElement with the rendered album share card.
 */
export async function generateAlbumCardCanvas(
  options: RenderAlbumCardOptions,
): Promise<HTMLCanvasElement> {
  const { album, themeColor, backgroundMode } = options
  const width = 540
  const height = 960

  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!

  const cardW = 440
  const cardH = 530
  const cardX = (width - cardW) / 2
  const cardY = Math.round((height - cardH) / 2)
  const cardRadius = 24
  const contentMidY = Math.round(cardY + cardH * 0.5)

  renderBackground(ctx, width, height, themeColor, backgroundMode, contentMidY)

  // Card background: pure black container
  ctx.save()
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)"
  ctx.shadowBlur = 40
  ctx.shadowOffsetY = 16
  ctx.fillStyle = "#000000"
  drawRoundRect(ctx, cardX, cardY, cardW, cardH, cardRadius)
  ctx.fill()
  ctx.restore()

  const artW = 380
  const artH = 380
  const artX = cardX + (cardW - artW) / 2
  const artY = cardY + 24
  const artRadius = 16

  const coverImg = album.artwork ? await loadImage(album.artwork) : null
  ctx.save()
  drawRoundRect(ctx, artX, artY, artW, artH, artRadius)
  ctx.clip()
  if (coverImg) {
    ctx.drawImage(coverImg, artX, artY, artW, artH)
  } else {
    ctx.fillStyle = "#1e2230"
    ctx.fillRect(artX, artY, artW, artH)
    ctx.fillStyle = "rgba(255, 255, 255, 0.3)"
    ctx.font = "bold 64px sans-serif"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText("💿", artX + artW / 2, artY + artH / 2)
  }
  ctx.restore()

  // Album Title
  ctx.save()
  ctx.fillStyle = "#FFFFFF"
  ctx.font = "bold 22px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
  ctx.textAlign = "left"
  ctx.textBaseline = "top"
  const textX = artX
  const titleY = artY + artH + 18
  fillTruncatedText(ctx, album.title, textX, titleY, cardW - 60)

  // Subtitle (Artist • Track Count)
  ctx.fillStyle = "#B3B9C9"
  ctx.font = "500 15px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
  const artistY = titleY + 30
  const subtitleParts = ["专辑"]
  if (album.artist) subtitleParts.push(album.artist)
  if (album.trackCount > 0) subtitleParts.push(`${album.trackCount} 首歌曲`)
  if (album.year) subtitleParts.push(String(album.year))
  fillTruncatedText(ctx, subtitleParts.join(" • "), textX, artistY, cardW - 60)
  ctx.restore()

  // Logo (140px, aligned to bottom-left with 20px bottom padding)
  const logoImg = await loadImage(BBEBEE_LOGO_DATA_URL)
  if (logoImg) {
    const logoW = 140
    const logoH = (logoW / logoImg.width) * logoImg.height
    const logoX = cardX + 26
    const logoY = cardY + cardH - logoH - 20
    ctx.drawImage(logoImg, logoX, logoY, logoW, logoH)
  }

  // Steganography
  try {
    const b64Payload = encodeMetadata("album", album)
    const imgData = ctx.getImageData(0, 0, width, height)
    const encoded = encodeSteganography(imgData, b64Payload)
    imgData.data.set(encoded.data)
    ctx.putImageData(imgData, 0, 0)
  } catch (err) {
    throw new Error(`隐写数据嵌入失败: ${String(err)}`)
  }

  return canvas
}

/**
 * Generates an HTMLCanvasElement with the rendered lyric share card (Matching reference image 2)
 * and embeds the metadata steganographically into its pixels.
 */
export async function generateLyricsCardCanvas(
  options: RenderLyricsCardOptions,
): Promise<HTMLCanvasElement> {
  const { lyrics, themeColor, backgroundMode } = options
  const width = 540
  const height = 960

  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!

  const lineCount = Math.max(1, Math.min(6, lyrics.lines.length))
  const cardW = 440
  const cardH = Math.min(390, Math.max(220, 130 + lineCount * 36))
  const cardX = (width - cardW) / 2
  const cardY = Math.round((height - cardH) / 2)
  const cardRadius = 24
  const contentMidY = Math.round(cardY + cardH * 0.5)

  // 1. Draw overall background (gradient to half of share content height)
  renderBackground(ctx, width, height, themeColor, backgroundMode, contentMidY)

  // 2. Draw Floating Card with bright cover theme color (NO dark mask, matching Spotify lyric share reference)
  ctx.save()
  ctx.shadowColor = "rgba(0, 0, 0, 0.45)"
  ctx.shadowBlur = 40
  ctx.shadowOffsetY = 16
  ctx.fillStyle = themeColor
  drawRoundRect(ctx, cardX, cardY, cardW, cardH, cardRadius)
  ctx.fill()
  ctx.restore()

  // Top Section: Mini cover + Title + Artist
  const miniCoverSize = 48
  const miniX = cardX + 22
  const miniY = cardY + 20
  const miniRadius = 8

  const coverImg = lyrics.artwork ? await loadImage(lyrics.artwork) : null
  ctx.save()
  drawRoundRect(ctx, miniX, miniY, miniCoverSize, miniCoverSize, miniRadius)
  ctx.clip()
  if (coverImg) {
    ctx.drawImage(coverImg, miniX, miniY, miniCoverSize, miniCoverSize)
  } else {
    ctx.fillStyle = "#1e2230"
    ctx.fillRect(miniX, miniY, miniCoverSize, miniCoverSize)
    ctx.fillStyle = "rgba(255, 255, 255, 0.3)"
    ctx.font = "bold 20px sans-serif"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText("♪", miniX + miniCoverSize / 2, miniY + miniCoverSize / 2)
  }
  ctx.restore()

  // Title next to mini cover (crisp white)
  ctx.save()
  ctx.fillStyle = "#FFFFFF"
  ctx.font = "bold 17px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
  ctx.textAlign = "left"
  ctx.textBaseline = "top"
  const metaX = miniX + miniCoverSize + 12
  const maxMetaW = cardW - 44 - miniCoverSize - 12
  fillTruncatedText(ctx, lyrics.title, metaX, miniY + 4, maxMetaW)

  // Artist (high contrast bright text)
  ctx.fillStyle = "rgba(255, 255, 255, 0.88)"
  ctx.font = "500 14px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
  fillTruncatedText(ctx, lyrics.artist, metaX, miniY + 26, maxMetaW)
  ctx.restore()

  // Middle Section: Lyric Lines (Bold white text)
  ctx.save()
  ctx.fillStyle = "#FFFFFF"
  ctx.font = "bold 21px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
  ctx.textAlign = "left"
  ctx.textBaseline = "top"
  const lyricStartX = cardX + 22
  const lyricStartY = miniY + miniCoverSize + 16
  const lineHeight = 34

  const linesToRender = lyrics.lines.slice(0, 6)
  linesToRender.forEach((line, idx) => {
    fillTruncatedText(ctx, line, lyricStartX, lyricStartY + idx * lineHeight, cardW - 44)
  })
  ctx.restore()

  // Bottom Section: BBeBee Logo (bottom-left)
  const logoImg = await loadImage(BBEBEE_LOGO_DATA_URL)
  if (logoImg) {
    const logoW = 140
    const logoH = (logoW / logoImg.width) * logoImg.height
    const logoX = cardX + 20
    const logoY = cardY + cardH - logoH - 14
    ctx.drawImage(logoImg, logoX, logoY, logoW, logoH)
  }

  // Steganography
  try {
    const b64Payload = encodeMetadata("lyrics", lyrics)
    const imgData = ctx.getImageData(0, 0, width, height)
    const encoded = encodeSteganography(imgData, b64Payload)
    imgData.data.set(encoded.data)
    ctx.putImageData(imgData, 0, 0)
  } catch (err) {
    throw new Error(`隐写数据嵌入失败: ${String(err)}`)
  }

  return canvas
}

/**
 * Downloads a canvas as a PNG file.
 */
export function downloadCanvasAsPng(canvas: HTMLCanvasElement, filename: string) {
  const dataUrl = canvas.toDataURL("image/png")
  const a = document.createElement("a")
  a.href = dataUrl
  a.download = filename.endsWith(".png") ? filename : filename + ".png"
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}
