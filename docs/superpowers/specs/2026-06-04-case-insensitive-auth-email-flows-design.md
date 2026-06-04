# Case-Insensitive Auth Email Flows Design

## Context

Z8 uses Better Auth in `apps/webapp/src/lib/auth.ts` with email/password sign-in, required email verification, password reset email delivery, and organization-aware email templates. Better Auth now supports case-insensitive string comparisons through adapter where clauses using `mode: "insensitive"`.

The goal is to let users enter the same email address with different casing across auth flows without changing the canonical email stored for the user.

## Scope

Apply case-insensitive email lookup behavior to these Better Auth flows where the user is resolved by email:

- Email/password sign-in.
- Password reset request lookup.
- Email verification flows that first resolve a user by submitted email, such as resend or pending-verification handling.

Do not normalize or rewrite stored user email values. Do not change organization scoping, session behavior, verification token storage, password hashing, or login UI messages.

## Approach

Prefer Better Auth's native adapter query support by adding `mode: "insensitive"` to email-based user lookups in the auth layer. This keeps behavior centralized in the server auth configuration instead of lowercasing client input or duplicating Better Auth's flow logic in app code.

If Better Auth exposes a direct configuration or callback for email lookup queries in the installed version, use that. If the only practical extension point is the internal adapter, wrap only the email-based user lookup path and delegate every non-email query unchanged.

## Data Flow

The login form and reset form continue submitting the user's entered email. Better Auth receives the original value, performs a case-insensitive lookup against the `user.email` field, then continues its existing password, verification, reset, and email delivery logic with the canonical stored user record.

Verification and reset tokens remain stored according to the existing `verification.storeIdentifier` settings. This design only changes user lookup by email, not verification-token or reset-token comparison semantics.

## Error Handling

Existing Better Auth error behavior remains authoritative. Unknown users, invalid passwords, unverified users, expired tokens, and reset requests should preserve current response behavior and timing protections.

## Testing

Add focused tests around the auth customization to verify email user lookups request `mode: "insensitive"`. Where practical, include coverage for sign-in, password reset, and verification lookup paths. Keep tests local to the auth layer and avoid relying on external services or Phase-managed environment variables.

## Non-Goals

- Migrating existing email data to lowercase.
- Adding database uniqueness migrations.
- Changing social OAuth email matching behavior unless it uses the same Better Auth user-email lookup path.
- Editing generated `src/db/auth-schema.ts` manually.
