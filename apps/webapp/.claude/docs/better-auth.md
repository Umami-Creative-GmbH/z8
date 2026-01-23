# Better Auth Schema

The file `src/db/auth-schema.ts` is **auto-generated** by Better Auth CLI. Never manually edit it.

## Adding Custom Fields

### User/Session tables

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
});
```

### Organization/Invitation/Member tables

Add `schema.additionalFields` to the organization plugin:

```typescript
organization({
  schema: {
    organization: {
      additionalFields: {
        country: { type: "string", required: false, input: true },
      },
    },
  },
});
```

## After Changing Fields

1. Regenerate schema:
   ```bash
   pnpm dlx @better-auth/cli generate -y --output src/db/auth-schema.ts
   ```

2. For ssoProvider table only - manually add:
   - `organizationId` FK reference to `organization.id`
   - Indexes for `organizationId` and `domain`
   - `organization` relation to `ssoProviderRelations`

3. Push to database:
   ```bash
   pnpm drizzle-kit push
   ```

## Plugin-Provided Fields (don't add manually)

| Plugin | Fields |
|--------|--------|
| Core | `id`, `name`, `email`, `emailVerified`, `image`, `createdAt`, `updatedAt` (user); `ipAddress`, `userAgent` (session) |
| Admin | `role`, `banned`, `banReason`, `banExpires` (user); `impersonatedBy` (session) |
| TwoFactor | `twoFactorEnabled` (user) |
| Organization | `activeOrganizationId` (session); organization, member, invitation tables |
| SSO | `ssoProvider` table with `domainVerified` flag |

## Current Custom Fields

**User table**: `canCreateOrganizations`, `invitedVia`

**Organization table**: `country` (ISO 3166-1 alpha-2), `region` (ISO 3166-2)

**Invitation table**: `canCreateOrganizations`

**userSettings table** (separate from auth): `timezone`, `onboardingComplete`, `onboardingStep`, `onboardingStartedAt`, `onboardingCompletedAt`, `dashboardWidgetOrder`, `dashboardWidgetVisibility`

## Type Inference

The auth-client uses `inferAdditionalFields` for automatic TypeScript inference:

```typescript
import { inferAdditionalFields, inferOrgAdditionalFields } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [
    inferAdditionalFields<typeof auth>(),
    organizationClient({
      schema: inferOrgAdditionalFields<typeof auth>(),
    }),
  ],
});
```
