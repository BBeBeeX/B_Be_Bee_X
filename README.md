# Folo-Style Cross-Platform Template

This template follows a Folo-like monorepo layout with:
- `pnpm` workspaces
- `turbo` task orchestration
- `apps/desktop` for Electron
- `apps/mobile` for Expo

## Quick Start

```bash
pnpm install
pnpm dev
```

## Workspace Commands

```bash
pnpm dev
pnpm build
pnpm lint
```

## Run One App

```bash
pnpm --filter @B_Be_Bee/desktop dev
pnpm --filter @B_Be_Bee/mobile dev
```

## Build Verification

```bash
pnpm --filter @B_Be_Bee/desktop build
pnpm --filter @B_Be_Bee/mobile build
```

## Notes

- This template is designed for `pnpm` + `turbo` workspaces.
