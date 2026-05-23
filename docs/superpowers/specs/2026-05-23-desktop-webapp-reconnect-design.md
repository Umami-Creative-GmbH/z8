# Desktop Webapp Reconnect Design

## Goal

Restore the Tauri desktop timer login flow against the current webapp authentication contract and default new desktop installs to the production webapp URL.

## Architecture

The desktop app remains a standalone Tauri timer that authenticates by opening the webapp in the system browser and receiving a `z8://auth/callback` deep link. The webapp now requires PKCE for app auth codes, so the desktop app will generate a verifier/challenge pair before login, keep the verifier in memory, and send it when exchanging the callback code.

## Components

- `apps/desktop/src-tauri/src/auth.rs` generates PKCE, opens the unified app-login route, and exchanges callback codes with a verifier.
- `apps/desktop/src-tauri/src/state.rs` owns the temporary pending PKCE verifier.
- `apps/desktop/src-tauri/src/settings.rs` defaults new installs to `https://ui.z8-time.app` while preserving saved settings.
- `apps/desktop/src-tauri/Cargo.toml` adds any small crypto/base64 dependencies needed for PKCE generation.

## Data Flow

1. User clicks sign in in the desktop app.
2. Desktop generates a verifier and SHA-256 base64url challenge.
3. Desktop stores the verifier in memory and opens `/api/auth/app-login?app=desktop&redirect=z8://auth/callback&challenge=<challenge>`.
4. Webapp authenticates the user and redirects to `z8://auth/callback?code=<code>`.
5. Desktop consumes the pending verifier and posts `{ code, verifier }` to `/api/auth/app-exchange` with `X-Z8-App-Type: desktop`.
6. Desktop stores the returned session token and continues existing bearer-token API calls.

## Error Handling

If the callback contains `error`, desktop emits the existing `auth_error` event. If a callback code arrives without a pending verifier, the exchange fails with a clear error instead of sending an incomplete request. The pending verifier is cleared after use so stale login attempts cannot be replayed accidentally.

## Testing

Rust unit tests will cover login URL construction and app-code exchange request bodies. Existing frontend build verification remains `pnpm --filter desktop build`. Rust tests should run with `cargo test` when required Linux system libraries are installed.
