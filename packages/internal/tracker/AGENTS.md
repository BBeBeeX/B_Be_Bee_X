# @b_be_bee/tracker
> Update this doc when analytics providers, tracker event contracts, or adapter boundaries change.

## Purpose

`packages/internal/tracker/` provides analytics abstractions and provider adapters so app code can emit tracking events through a consistent interface.

## File Inventory

- `src/index.ts` - tracker package entrypoint.
- `src/manager.ts`, `src/track-manager.ts` - orchestration logic for tracker lifecycle and dispatch.
- `src/tracker-points.ts`, `src/enums.ts`, `src/utils.ts` - event definitions and utilities.
- `src/adapters/` - provider implementations such as Firebase, PostHog, and proxy adapters.

## Key Exports

- Root tracker APIs from `src/index.ts`
- Adapter and manager surfaces under `src/`

## Dependencies

- Depends on: `@b_be_bee/logger`, analytics SDK peer dependencies, and shared config from `@b_be_bee/configs`.
- Depended on by: app telemetry flows and shared state modules that emit analytics events.
