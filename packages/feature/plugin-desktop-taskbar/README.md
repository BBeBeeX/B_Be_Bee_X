# @BBeBee/plugin-desktop-taskbar

Desktop taskbar and tray playback controls for BBeBee.

## What it does

- Synchronizes current playback state (`isPlaying`, `canPlayOrPause`, `canPrevious`, `canNext`, track title, and artist) to the desktop host via `window.BBeBee.taskbar`.
- Coordinates with the desktop host to display Play/Pause, Previous, and Next buttons on the Windows thumbnail toolbar (`setThumbarButtons`) and the system tray context menu.
- Receives user interactions from taskbar thumbnail buttons and tray items, dispatching them to `ctx.player.togglePlay()`, `ctx.player.previous()`, and `ctx.player.next()`.
