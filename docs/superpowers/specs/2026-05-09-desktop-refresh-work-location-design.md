# Desktop Refresh And Work Location Design

## Context

The desktop app is a Tauri 2 app with a Vite React frontend in `apps/desktop`. It clocks users in and out by calling the webapp's `/api/time-entries` endpoint through Rust commands. The webapp already supports work locations on clock-in through `workLocationType` and currently accepts these values: `office`, `home`, `remote`, and `other`.

The desktop app has not been touched recently. A dependency check found only small safe frontend package updates for the desktop workspace: `postcss`, `tailwindcss`, and `@tailwindcss/postcss`.

## Goals

- Refresh the desktop app with low-risk dependency updates.
- Add work-location selection to desktop clock-in.
- Match the webapp's existing work-location values and avoid backend schema changes.
- Keep clock-out behavior unchanged.

## Non-Goals

- Do not introduce a new `field` database value in this pass.
- Do not redesign the desktop app shell.
- Do not change tenant-specific configuration or add environment variables.
- Do not broaden native Tauri/Rust upgrades unless required by verification.

## Approach

Use a focused refresh.

The desktop UI will expose a compact work-location selector using the backend-supported values:

- `office`, displayed as `Office / On-site`
- `home`, displayed as `Home`
- `remote`, displayed as `Remote`
- `other`, displayed as `Other`

The selected value will default to `office` and persist locally in the desktop UI so users do not need to reselect it every time. When the user clocks in, the selected value will flow from React to the Tauri command, then to the Rust `ClockService`, and finally to `/api/time-entries` as `workLocationType`.

## Components And Data Flow

1. React UI stores the selected work-location type.
2. `ClockButton` or the surrounding app layout renders the selector near the clock-in action.
3. `useClock` accepts a work-location parameter for `clockIn`.
4. The Tauri `clock_in` command accepts the work-location value.
5. Rust `ClockService::clock_in` includes `workLocationType` in the JSON request body.
6. The existing web API validates and persists the value on the active work period.

Clock-out remains unchanged because work location is assigned at clock-in.

## Offline Behavior

If desktop offline queuing supports metadata safely, queued clock-ins should include the selected work location. If the current queue format cannot support this without a broader migration, the online path will be implemented first and the limitation will be documented in the implementation summary.

## Error Handling

The desktop app will send only known work-location values, so invalid-location API errors should be rare. If the server rejects the value, the existing desktop clock-in error flow will show a failure toast and leave the user unclocked-in unless the request is queued due to a network failure.

## Testing And Verification

- Run the desktop frontend build with `pnpm --filter desktop build`.
- Run Rust/Tauri checks if available and feasible for the desktop package.
- Verify the generated request body includes `workLocationType` for clock-in.
- Confirm the dependency refresh remains limited to safe desktop package updates.
