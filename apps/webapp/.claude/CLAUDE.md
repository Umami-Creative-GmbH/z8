# Better Auth Schema Instructions

## CRITICAL: Do NOT Manually Edit auth-schema.ts

The file `src/db/auth-schema.ts` is **auto-generated** by Better Auth CLI and will be overwritten on every:
- Better Auth package update
- Running `bunx @better-auth/cli generate`
- Running `bunx @better-auth/cli migrate`

**Never manually add, modify, or remove fields from this file.**

---

## How to Add Custom Fields

### For User/Session tables

Add `additionalFields` in `src/lib/auth.ts`:

```typescript
export const auth = betterAuth({
  user: {
    additionalFields: {
      myCustomField: {
        type: "string",
        required: false,
        defaultValue: "default",
        input: false, // false = system-managed, true = user can provide
      },
    },
  },
  session: {
    additionalFields: {
      // session custom fields here
    },
  },
});
```

### For Organization/Invitation/Member tables

Add `schema.additionalFields` to the organization plugin:

```typescript
organization({
  schema: {
    organization: {
      additionalFields: {
        country: { type: "string", required: false, input: true },
      },
    },
    invitation: {
      additionalFields: {
        canCreateOrganizations: { type: "boolean", required: false, defaultValue: false },
      },
    },
  },
});
```

---

## After Adding/Changing Fields

1. Run CLI to regenerate schema (use `--output` to specify location):
   ```bash
   bunx --bun npx @better-auth/cli generate -y --output src/db/auth-schema.ts
   ```

2. Add FK constraint and indexes to ssoProvider (CLI doesn't generate these):
   - Add `organizationId` FK reference to `organization.id`
   - Add indexes for `organizationId` and `domain`
   - Add `organization` relation to `ssoProviderRelations`

3. Push schema to database:
   ```bash
   bun drizzle-kit push
   ```

---

## What's Provided by Better Auth Plugins

These fields are automatically included when their plugins are enabled - do NOT add them manually:

| Plugin | Fields Provided |
|--------|-----------------|
| **Core** | `id`, `name`, `email`, `emailVerified`, `image`, `createdAt`, `updatedAt` (user); `ipAddress`, `userAgent` (session) |
| **Admin** | `role`, `banned`, `banReason`, `banExpires` (user); `impersonatedBy` (session) |
| **TwoFactor** | `twoFactorEnabled` (user) |
| **Organization** | `activeOrganizationId` (session); organization, member, invitation tables |
| **SSO** | `ssoProvider` table with `domainVerified` flag (verification token is returned via API, not stored in DB) |

---

## Current Custom Fields (defined in auth.ts)

### User table
- `canCreateOrganizations` - Permission to create organizations
- `invitedVia` - Tracks which invitation was used
- `onboardingComplete` - Onboarding completion status
- `onboardingStep` - Current onboarding step
- `onboardingStartedAt` - When onboarding started
- `onboardingCompletedAt` - When onboarding finished
- `timezone` - User's timezone preference (e.g., "UTC", "America/New_York")

### Organization table
- `country` - ISO 3166-1 alpha-2 country code (e.g., "DE", "US")
- `region` - ISO 3166-2 subdivision code (e.g., "BY" for Bavaria)

### Invitation table
- `canCreateOrganizations` - Permission grant during invitation

---

## Type Inference

The auth-client.ts uses `inferAdditionalFields` and `inferOrgAdditionalFields` to automatically infer types for custom fields. This ensures TypeScript knows about all custom fields when using `useSession`, `signUp`, organization methods, etc.

```typescript
import { inferAdditionalFields, inferOrgAdditionalFields } from "better-auth/client/plugins";
import type { auth } from "./auth";

export const authClient = createAuthClient({
  plugins: [
    inferAdditionalFields<typeof auth>(),
    organizationClient({
      schema: inferOrgAdditionalFields<typeof auth>(),
    }),
  ],
});
```
