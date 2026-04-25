import {once} from "../utils";

export type OS = "macOS" | "iOS" | "Windows" | "Android" | "Linux" | ""
type NodePlatform = "aix" | "android" | "darwin" | "freebsd" | "linux" | "openbsd" | "sunos" | "win32" | "cygwin" | "netbsd"

declare const window: {
    platform: NodePlatform
    navigator: Navigator
}
declare const ELECTRON: boolean

export const getOS = once((): OS => {
    if (window.platform) {
        switch (window.platform) {
            case "darwin": {
                return "macOS"
            }
            case "win32": {
                return "Windows"
            }
            case "linux": {
                return "Linux"
            }
        }
    }

    const { userAgent } = window.navigator,
        macosPlatforms = ["Macintosh", "MacIntel", "MacPPC", "Mac68K"],
        windowsPlatforms = ["Win32", "Win64", "Windows", "WinCE"],
        iosPlatforms = ["iPhone", "iPad", "iPod"]
    // @ts-expect-error
    const platform = window.navigator.userAgentData?.platform || window.navigator.platform
    let os = platform

    if (macosPlatforms.includes(platform)) {
        os = "macOS"
    } else if (iosPlatforms.includes(platform)) {
        os = "iOS"
    } else if (windowsPlatforms.includes(platform)) {
        os = "Windows"
    } else if (/Android/.test(userAgent)) {
        os = "Android"
    } else if (!os && /Linux/.test(platform)) {
        os = "Linux"
    }

    return os as OS
})

export function getBrowser() {
    const { userAgent } = navigator
    if (userAgent.includes("Edg")) {
        return "Microsoft Edge"
    } else if (userAgent.includes("Chrome")) {
        return "Chrome"
    } else if (userAgent.includes("Firefox")) {
        return "Firefox"
    } else if (userAgent.includes("Safari")) {
        return "Safari"
    } else if (userAgent.includes("Opera")) {
        return "Opera"
    } else if (userAgent.includes("Trident") || userAgent.includes("MSIE")) {
        return "Internet Explorer"
    }

    return "Unknown"
}

export const isSafari = once(() => {
    if (ELECTRON) return false
    const ua = window.navigator.userAgent
    return (ua.includes("Safari") || ua.includes("AppleWebKit")) && !ua.includes("Chrome")
})

export function isKeyForMultiSelectPressed(e: MouseEvent) {
    if (getOS() === "macOS") {
        return e.metaKey || e.shiftKey
    }
    return e.ctrlKey || e.shiftKey
}

export type MobilePlatform = "iOS" | "Android" | null

export const getMobilePlatform = once((): MobilePlatform => {
    const os = getOS()

    return ["iOS", "Android"].includes(os) ? (os as MobilePlatform) : null
})

export const isMobileDevice = once((): boolean => {
    return getMobilePlatform() !== null
})
