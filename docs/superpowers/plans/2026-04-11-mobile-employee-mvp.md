# Mobile Employee MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first employee-facing mobile app for clock in/out, attendance status, organization switching, and self-service absences on top of the existing Z8 org-scoped backend.

**Architecture:** Keep the mobile app small and native-feeling: Expo Router screens backed by TanStack Query and TanStack Form, with bearer-token authentication obtained from the webapp through a deep-link login handoff. On the backend, add a thin mobile API surface in `apps/webapp/src/app/api/mobile/*` plus a reusable app-login route so mobile can consume the existing time-tracking and absence rules without duplicating business logic.

**Tech Stack:** Expo Router, React Native, TypeScript, TanStack Query, TanStack Form, Luxon, Expo Secure Store, Expo WebBrowser, Next.js App Router API routes, Better Auth bearer tokens, Drizzle ORM, Vitest.

---

## Execution Context

- Implement this in a dedicated worktree before touching code, for example `/home/kai/projects/z8/.worktrees/mobile-employee-mvp`.
- Set `EXPO_PUBLIC_WEBAPP_URL` for the mobile app before manual verification, for example `http://localhost:3000` in local development.
- The mobile app should identify itself with `X-Z8-App-Type: mobile` on every bearer-authenticated request so app-access checks can reliably distinguish mobile from desktop.
- Do not add offline queueing, manager flows, or mobile-only business rules in this phase.

## File Map

- Modify: `apps/mobile/package.json`
  - Add the mobile runtime and test dependencies plus `test` and `test:watch` scripts.
- Create: `apps/mobile/vitest.config.ts`
  - Mobile-specific Vitest config for pure logic and lightweight React Native component tests.
- Create: `apps/mobile/test/setup.ts`
  - Shared mocks for Expo Router, Secure Store, and React Native test helpers.
- Create: `apps/mobile/src/lib/config.ts`
  - Centralize `EXPO_PUBLIC_WEBAPP_URL` resolution and the shared mobile app-type header.
- Create: `apps/mobile/src/lib/auth/session-store.ts`
  - Secure token persistence helpers using Expo Secure Store.
- Create: `apps/mobile/src/lib/auth/app-auth.ts`
  - Build the app-login URL, parse deep-link callback tokens, and expose small auth utility helpers.
- Create: `apps/mobile/src/lib/auth/app-auth.test.ts`
  - Lock the deep-link auth contract before wiring screens.
- Create: `apps/mobile/src/lib/query/query-client.ts`
  - Export one QueryClient instance with predictable defaults for org-scoped refetches.
- Create: `apps/mobile/src/lib/api/client.ts`
  - Shared mobile fetch wrapper that sends bearer auth and `X-Z8-App-Type: mobile`.
- Modify: `apps/mobile/app/_layout.tsx`
  - Wrap the app in QueryClient and session providers.
- Modify: `apps/mobile/app/index.tsx`
  - Replace the placeholder splash screen with an auth gate redirect.
- Create: `apps/mobile/app/sign-in.tsx`
  - Lightweight sign-in entry that launches the browser-based webapp login flow.
- Create: `apps/mobile/app/(app)/_layout.tsx`
  - Tabs shell for `home`, `absences`, and `profile`.
- Create: `apps/mobile/app/(app)/home.tsx`
  - Route wrapper for the home screen.
- Create: `apps/mobile/app/(app)/absences/index.tsx`
  - Route wrapper for the absences screen.
- Create: `apps/mobile/app/(app)/absences/request.tsx`
  - Route wrapper for the absence request form.
- Create: `apps/mobile/app/(app)/profile.tsx`
  - Route wrapper for session state, org switcher, and sign out.
- Create: `apps/mobile/src/features/session/use-mobile-session.ts`
  - Query the mobile session route, reconcile deep-link callbacks, and expose org switching and sign-out.
- Create: `apps/mobile/src/features/session/use-mobile-session.test.ts`
  - Cover session bootstrap, callback handling, and cache reset behavior.
- Create: `apps/mobile/src/features/home/use-home-query.ts`
  - Query and mutate the mobile home payload.
- Create: `apps/mobile/src/features/home/work-location-picker.tsx`
  - Compact required location selector for clock-in.
- Create: `apps/mobile/src/features/home/home-screen.tsx`
  - Clock-first mobile home screen with today summary.
- Create: `apps/mobile/src/features/home/home-screen.test.tsx`
  - Verify required location gating, working state, and submission locking.
- Create: `apps/mobile/src/features/profile/profile-screen.tsx`
  - Show active org, allow org switching, and sign out.
- Create: `apps/mobile/src/features/profile/profile-screen.test.tsx`
  - Verify active-org clarity, switch actions, and query invalidation callbacks.
- Create: `apps/mobile/src/features/absences/use-absences-query.ts`
  - Query absence list data and expose request or cancel mutations.
- Create: `apps/mobile/src/features/absences/absences-screen.tsx`
  - Render upcoming, pending, and past filters plus request and cancel entry points.
- Create: `apps/mobile/src/features/absences/absences-screen.test.tsx`
  - Cover filter rendering and pending-only cancellation affordances.
- Create: `apps/mobile/src/features/absences/request-absence-form.ts`
  - TanStack Form setup, date validation, and payload shaping.
- Create: `apps/mobile/src/features/absences/request-absence-screen.tsx`
  - Mobile request absence form with submit handling.
- Create: `apps/mobile/src/features/absences/request-absence-screen.test.tsx`
  - Verify same-day validation and submit payload shape.
- Modify: `apps/webapp/src/lib/effect/services/app-access.service.ts`
  - Treat `X-Z8-App-Type: mobile` as the canonical mobile app-type signal.
- Create: `apps/webapp/src/app/api/auth/app-login/route.ts`
  - Generic bearer-token deep-link login route for `desktop` and `mobile` clients.
- Create: `apps/webapp/src/app/api/auth/app-login/route.test.ts`
  - Verify redirect scheme validation, callback preservation, and mobile access checks.
- Create: `apps/webapp/src/app/api/mobile/shared.ts`
  - Shared helpers for mobile session auth, org scoping, and `NextResponse` helpers.
- Create: `apps/webapp/src/app/api/mobile/session/route.ts`
  - Return authenticated mobile session and org data.
- Create: `apps/webapp/src/app/api/mobile/session/route.test.ts`
  - Verify org-scoped session payloads and blocked states.
- Modify: `apps/webapp/src/app/api/organizations/switch/route.ts`
  - Accept the mobile app-type header and enforce app access for bearer-token switches.
- Create: `apps/webapp/src/app/api/mobile/home/route.ts`
  - Aggregate clock state, today summary, and next approved absence for the mobile home screen.
- Create: `apps/webapp/src/app/api/mobile/home/route.test.ts`
  - Lock the home payload contract before screen work starts.
- Create: `apps/webapp/src/app/api/mobile/time-clock/route.ts`
  - Mobile clock in/out mutation route that reuses the existing clocking server logic.
- Create: `apps/webapp/src/app/api/mobile/time-clock/route.test.ts`
  - Verify work-location-required clock-in and authenticated clock-out behavior.
- Create: `apps/webapp/src/app/api/mobile/absences/route.ts`
  - GET the employee’s absence data and POST new requests.
- Create: `apps/webapp/src/app/api/mobile/absences/route.test.ts`
  - Lock the list and create contract for the mobile absence flow.
- Create: `apps/webapp/src/app/api/mobile/absences/[absenceId]/cancel/route.ts`
  - Cancel only the caller’s pending absence requests.
- Create: `apps/webapp/src/app/api/mobile/absences/[absenceId]/cancel/route.test.ts`
  - Verify pending-only cancel rules.

## Implementation Notes

- Prefer one mobile API payload per screen instead of many small calls.
- Reuse existing clock-in, clock-out, absence request, and cancel logic wherever possible.
- Keep every mobile API route org-scoped through the active Better Auth organization.
- The current `apps/webapp/src/app/api/auth/desktop-login/route.ts` only accepts `z8://` redirects and uses `desktop_redirect`, which is not the same callback shape already supported by `LoginForm`. Do not extend that route in place; create `app-login` that uses `callbackUrl` so login continuation is explicit and reusable.
- Mobile should use bearer tokens; Expo-specific Better Auth integration is not required for this MVP because the repo already supports bearer-authenticated non-web clients.

### Task 1: Scaffold the mobile workspace and auth utilities

**Files:**
- Modify: `apps/mobile/package.json`
- Create: `apps/mobile/vitest.config.ts`
- Create: `apps/mobile/test/setup.ts`
- Create: `apps/mobile/src/lib/config.ts`
- Create: `apps/mobile/src/lib/auth/session-store.ts`
- Create: `apps/mobile/src/lib/auth/app-auth.ts`
- Create: `apps/mobile/src/lib/auth/app-auth.test.ts`
- Create: `apps/mobile/src/lib/query/query-client.ts`
- Modify: `apps/mobile/app/_layout.tsx`
- Modify: `apps/mobile/app/index.tsx`
- Create: `apps/mobile/app/(app)/_layout.tsx`
- Create: `apps/mobile/app/(app)/home.tsx`
- Create: `apps/mobile/app/(app)/absences/index.tsx`
- Create: `apps/mobile/app/(app)/profile.tsx`

- [ ] **Step 1: Write the failing auth utility test**

```ts
import { describe, expect, it } from "vitest";
import {
  MOBILE_APP_TYPE_HEADER,
  buildAppLoginUrl,
  extractSessionTokenFromCallback,
} from "./app-auth";

describe("buildAppLoginUrl", () => {
  it("builds the mobile app-login URL with the redirect preserved", () => {
    expect(buildAppLoginUrl("https://ui.z8-time.app", "z8mobile://auth/callback")).toBe(
      "https://ui.z8-time.app/api/auth/app-login?app=mobile&redirect=z8mobile%3A%2F%2Fauth%2Fcallback",
    );
  });
});

describe("extractSessionTokenFromCallback", () => {
  it("returns the bearer token from the deep-link callback", () => {
    expect(extractSessionTokenFromCallback("z8mobile://auth/callback?token=abc123")).toBe("abc123");
  });

  it("returns null when the callback does not contain a token", () => {
    expect(extractSessionTokenFromCallback("z8mobile://auth/callback?error=access_denied")).toBeNull();
  });
});

describe("MOBILE_APP_TYPE_HEADER", () => {
  it("always tags requests as mobile", () => {
    expect(MOBILE_APP_TYPE_HEADER).toEqual({ "X-Z8-App-Type": "mobile" });
  });
});
```

- [ ] **Step 2: Run the mobile auth utility test to verify it fails**

Run: `pnpm --filter mobile test -- src/lib/auth/app-auth.test.ts`

Expected: FAIL because `app-auth.ts`, the exported helpers, and the mobile `test` script do not exist yet.

- [ ] **Step 3: Add the mobile auth and config primitives**

Create the shared helpers with concrete implementations:

```ts
import * as SecureStore from "expo-secure-store";

export const MOBILE_APP_TYPE_HEADER = { "X-Z8-App-Type": "mobile" } as const;
export const MOBILE_TOKEN_KEY = "z8.mobile.session-token";

export function getWebappUrl() {
  const value = process.env.EXPO_PUBLIC_WEBAPP_URL;
  if (!value) {
    throw new Error("EXPO_PUBLIC_WEBAPP_URL is required for the mobile app");
  }
  return value.replace(/\/$/, "");
}

export function buildAppLoginUrl(baseUrl: string, redirectUri: string) {
  const url = new URL("/api/auth/app-login", baseUrl);
  url.searchParams.set("app", "mobile");
  url.searchParams.set("redirect", redirectUri);
  return url.toString();
}

export function extractSessionTokenFromCallback(callbackUrl: string) {
  const url = new URL(callbackUrl);
  return url.searchParams.get("token");
}

export async function readSessionToken() {
  return SecureStore.getItemAsync(MOBILE_TOKEN_KEY);
}

export async function writeSessionToken(token: string) {
  await SecureStore.setItemAsync(MOBILE_TOKEN_KEY, token);
}

export async function clearSessionToken() {
  await SecureStore.deleteItemAsync(MOBILE_TOKEN_KEY);
}
```

- [ ] **Step 4: Add the mobile package scripts, test harness, and route shell**

Update `apps/mobile/package.json` and the router shell with the minimum app structure:

```json
{
  "scripts": {
    "dev": "expo start",
    "android": "expo start --android",
    "ios": "expo start --ios",
    "web": "expo start --web",
    "build": "expo export",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@tanstack/react-form": "^1.28.6",
    "@tanstack/react-query": "^5.97.0",
    "@react-native-community/datetimepicker": "^8.4.4",
    "expo-secure-store": "~15.0.7",
    "expo-web-browser": "~15.0.8",
    "luxon": "^3.7.2"
  },
  "devDependencies": {
    "@testing-library/react-native": "^13.3.3",
    "vitest": "^4.1.4"
  }
}
```

```tsx
import { Stack } from "expo-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/src/lib/query/query-client";

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="(app)" />
      </Stack>
    </QueryClientProvider>
  );
}
```

```tsx
import { Redirect } from "expo-router";

export default function IndexScreen() {
  return <Redirect href="/sign-in" />;
}
```

```tsx
import { Tabs } from "expo-router";

export default function AppLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="home" options={{ title: "Home" }} />
      <Tabs.Screen name="absences/index" options={{ title: "Absences" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
    </Tabs>
  );
}
```

```ts
import { QueryClient } from "@tanstack/react-query";

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 30_000,
      },
    },
  });
}

export const queryClient = createQueryClient();
```

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
  },
});
```

- [ ] **Step 5: Re-run the mobile auth utility test**

Run: `pnpm --filter mobile test -- src/lib/auth/app-auth.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/package.json apps/mobile/vitest.config.ts apps/mobile/test/setup.ts apps/mobile/src/lib/config.ts apps/mobile/src/lib/auth/session-store.ts apps/mobile/src/lib/auth/app-auth.ts apps/mobile/src/lib/auth/app-auth.test.ts apps/mobile/src/lib/query/query-client.ts apps/mobile/app/_layout.tsx apps/mobile/app/index.tsx apps/mobile/app/(app)/_layout.tsx apps/mobile/app/(app)/home.tsx apps/mobile/app/(app)/absences/index.tsx apps/mobile/app/(app)/profile.tsx
git commit -m "feat: scaffold mobile app shell"
```

### Task 2: Add mobile login, session, and organization APIs on the webapp

**Files:**
- Modify: `apps/webapp/src/lib/effect/services/app-access.service.ts`
- Create: `apps/webapp/src/app/api/auth/app-login/route.ts`
- Create: `apps/webapp/src/app/api/auth/app-login/route.test.ts`
- Create: `apps/webapp/src/app/api/mobile/shared.ts`
- Create: `apps/webapp/src/app/api/mobile/session/route.ts`
- Create: `apps/webapp/src/app/api/mobile/session/route.test.ts`
- Modify: `apps/webapp/src/app/api/organizations/switch/route.ts`

- [ ] **Step 1: Write the failing mobile auth route tests**

```ts
import { describe, expect, it } from "vitest";

describe("app-login route", () => {
  it("accepts z8mobile redirects for mobile clients", async () => {
    const request = new Request(
      "https://ui.z8-time.app/api/auth/app-login?app=mobile&redirect=z8mobile://auth/callback",
    );

    const response = await GET(request as any);
    expect(response.status).not.toBe(400);
  });

  it("redirects unauthenticated mobile requests through sign-in using callbackUrl", async () => {
    const request = new Request(
      "https://ui.z8-time.app/api/auth/app-login?app=mobile&redirect=z8mobile://auth/callback",
    );

    const response = await GET(request as any);
    expect(response.headers.get("location")).toContain("/sign-in?callbackUrl=");
  });
});

describe("mobile session route", () => {
  it("returns active organization and org memberships for a mobile bearer session", async () => {
    const response = await GET();
    const payload = await response.json();

    expect(payload).toMatchObject({
      user: { id: expect.any(String) },
      activeOrganizationId: expect.anything(),
      organizations: expect.any(Array),
    });
  });
});
```

- [ ] **Step 2: Run the focused webapp tests to verify they fail**

Run: `pnpm --filter webapp test -- src/app/api/auth/app-login/route.test.ts src/app/api/mobile/session/route.test.ts`

Expected: FAIL because the mobile routes do not exist yet.

- [ ] **Step 3: Implement the reusable app-login route and mobile session helpers**

Create the new route and helper layer instead of stretching `desktop-login`:

```ts
import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const APP_REDIRECT_SCHEMES = {
  desktop: "z8://",
  mobile: "z8mobile://",
} as const;

export async function GET(request: NextRequest) {
  const app = request.nextUrl.searchParams.get("app") === "desktop" ? "desktop" : "mobile";
  const redirectUrl = request.nextUrl.searchParams.get("redirect");

  if (!redirectUrl || !redirectUrl.startsWith(APP_REDIRECT_SCHEMES[app])) {
    return NextResponse.json({ error: `Invalid ${app} redirect URL` }, { status: 400 });
  }

  const resolvedHeaders = await headers();
  const session = await auth.api.getSession({ headers: resolvedHeaders });

  if (!session?.user) {
    const callbackUrl = new URL(request.nextUrl.pathname + request.nextUrl.search, request.nextUrl.origin);
    const loginUrl = new URL("/sign-in", request.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", callbackUrl.toString());
    return NextResponse.redirect(loginUrl);
  }

  const hasRequestedAppAccess =
    app === "mobile" ? (session.user.canUseMobile ?? true) : (session.user.canUseDesktop ?? true);

  if (!hasRequestedAppAccess) {
    const deniedUrl = new URL(redirectUrl);
    deniedUrl.searchParams.set("error", "access_denied");
    return NextResponse.redirect(deniedUrl.toString());
  }

  const deepLinkUrl = new URL(redirectUrl);
  deepLinkUrl.searchParams.set("token", session.session.token);
  return NextResponse.redirect(deepLinkUrl.toString());
}
```

```ts
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { employee } from "@/db/schema";
import { auth } from "@/lib/auth";
import { getUserOrganizations, validateAppAccess } from "@/lib/auth-helpers";

export async function requireMobileSession() {
  const resolvedHeaders = await headers();
  const session = await auth.api.getSession({ headers: resolvedHeaders });

  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const accessCheck = await validateAppAccess(session.user, resolvedHeaders);
  if (!accessCheck.allowed || accessCheck.appType !== "mobile") {
    return { error: NextResponse.json({ error: "Mobile access denied" }, { status: 403 }) };
  }

  return { session, resolvedHeaders };
}

export async function requireMobileEmployee(userId: string, organizationId: string | null) {
  if (!organizationId) {
    throw new Error("Active organization is required for mobile employee access");
  }

  const employeeRecord = await db.query.employee.findFirst({
    where: and(
      eq(employee.userId, userId),
      eq(employee.organizationId, organizationId),
      eq(employee.isActive, true),
    ),
  });

  if (!employeeRecord) {
    throw new Error("Employee profile not found in the active organization");
  }

  return employeeRecord;
}
```

- [ ] **Step 4: Update app access detection and org switching for mobile requests**

Make the app-type signal explicit and preserve it in org switching:

```ts
export function detectAppType(headers: Headers): AppType {
  const explicitAppType = headers.get("x-z8-app-type");
  if (explicitAppType === "mobile") {
    return "mobile";
  }
  if (explicitAppType === "desktop") {
    return "desktop";
  }

  const authHeader = headers.get("authorization");
  if (authHeader?.toLowerCase().startsWith("bearer ")) {
    const userAgent = headers.get("user-agent")?.toLowerCase() || "";
    return userAgent.includes("react native") ? "mobile" : "desktop";
  }

  return "webapp";
}
```

```ts
const allowHeaders = "Content-Type, Authorization, X-Z8-App-Type";

const accessCheck = await validateAppAccess(session.user, resolvedHeaders);
if (!accessCheck.allowed) {
  return NextResponse.json({ error: "Access denied" }, { status: 403, headers: corsHeaders });
}
```

Then create `apps/webapp/src/app/api/mobile/session/route.ts` with a concrete payload:

```ts
export async function GET() {
  const mobile = await requireMobileSession();
  if ("error" in mobile) return mobile.error;

  const organizations = await getUserOrganizations();

  return NextResponse.json({
    user: {
      id: mobile.session.user.id,
      name: mobile.session.user.name,
      email: mobile.session.user.email,
    },
    activeOrganizationId: mobile.session.session.activeOrganizationId ?? null,
    organizations: organizations.map((org) => ({
      id: org.id,
      name: org.name,
      slug: org.slug,
      hasEmployeeRecord: org.hasEmployeeRecord,
    })),
  });
}
```

- [ ] **Step 5: Re-run the mobile auth and session tests**

Run: `pnpm --filter webapp test -- src/app/api/auth/app-login/route.test.ts src/app/api/mobile/session/route.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/src/lib/effect/services/app-access.service.ts apps/webapp/src/app/api/auth/app-login/route.ts apps/webapp/src/app/api/auth/app-login/route.test.ts apps/webapp/src/app/api/mobile/shared.ts apps/webapp/src/app/api/mobile/session/route.ts apps/webapp/src/app/api/mobile/session/route.test.ts apps/webapp/src/app/api/organizations/switch/route.ts
git commit -m "feat: add mobile auth and session routes"
```

### Task 3: Wire the mobile session hook, sign-in screen, and profile shell

**Files:**
- Create: `apps/mobile/src/features/session/use-mobile-session.ts`
- Create: `apps/mobile/src/features/session/use-mobile-session.test.ts`
- Modify: `apps/mobile/app/index.tsx`
- Create: `apps/mobile/app/sign-in.tsx`
- Create: `apps/mobile/src/features/profile/profile-screen.tsx`
- Create: `apps/mobile/src/features/profile/profile-screen.test.tsx`
- Modify: `apps/mobile/app/(app)/profile.tsx`

- [ ] **Step 1: Write the failing session hook and profile tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { createQueryClient } from "@/src/lib/query/query-client";
import { createMobileSessionController } from "./use-mobile-session";

describe("createMobileSessionController", () => {
  it("stores a callback token and invalidates the mobile session query", async () => {
    const queryClient = createQueryClient();
    const writeToken = vi.fn();
    const controller = createMobileSessionController({
      queryClient,
      writeToken,
      clearToken: vi.fn(),
    });

    await controller.handleCallbackUrl("z8mobile://auth/callback?token=abc123");

    expect(writeToken).toHaveBeenCalledWith("abc123");
  });
});
```

```tsx
import { fireEvent, render, screen } from "@testing-library/react-native";
import { describe, expect, it, vi } from "vitest";
import { ProfileScreen } from "./profile-screen";

describe("ProfileScreen", () => {
  it("shows the active organization and switches to another org", async () => {
    const onSwitchOrganization = vi.fn();

    render(
      <ProfileScreen
        activeOrganizationId="org-1"
        organizations={[
          { id: "org-1", name: "Alpha", hasEmployeeRecord: true },
          { id: "org-2", name: "Beta", hasEmployeeRecord: true },
        ]}
        onSwitchOrganization={onSwitchOrganization}
        onSignOut={() => {}}
        isSwitching={false}
      />,
    );

    expect(screen.getByText("Alpha")).toBeTruthy();
    fireEvent.press(screen.getByText("Beta"));
    expect(onSwitchOrganization).toHaveBeenCalledWith("org-2");
  });
});
```

- [ ] **Step 2: Run the mobile session and profile tests to verify they fail**

Run: `pnpm --filter mobile test -- src/features/session/use-mobile-session.test.ts src/features/profile/profile-screen.test.tsx`

Expected: FAIL because the hook and profile screen do not exist yet.

- [ ] **Step 3: Implement the mobile session controller and query hook**

Build the session feature around the new webapp route and stored bearer token:

```ts
import * as Linking from "expo-linking";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { clearSessionToken, readSessionToken, writeSessionToken } from "@/src/lib/auth/session-store";
import { extractSessionTokenFromCallback } from "@/src/lib/auth/app-auth";
import { apiFetch } from "@/src/lib/api/client";

export function createMobileSessionController({ queryClient, writeToken, clearToken }) {
  return {
    async handleCallbackUrl(url: string) {
      const token = extractSessionTokenFromCallback(url);
      if (!token) return false;
      await writeToken(token);
      await queryClient.invalidateQueries({ queryKey: ["mobile-session"] });
      return true;
    },
    async signOut() {
      await clearToken();
      await queryClient.clear();
    },
  };
}

export function useMobileSession() {
  const queryClient = useQueryClient();
  const controller = createMobileSessionController({
    queryClient,
    writeToken: writeSessionToken,
    clearToken: clearSessionToken,
  });

  const sessionQuery = useQuery({
    queryKey: ["mobile-session"],
    queryFn: async () => {
      const token = await readSessionToken();
      if (!token) return null;
      const session = await apiFetch("/api/mobile/session", { token });
      return { ...session, token };
    },
  });

  return { ...sessionQuery, controller };
}
```

- [ ] **Step 4: Replace the placeholder sign-in flow with the browser handoff and profile screen**

Wire the auth gate and profile screen to the session hook:

```tsx
import { Redirect } from "expo-router";
import { useMobileSession } from "@/src/features/session/use-mobile-session";

export default function IndexScreen() {
  const { data, isLoading } = useMobileSession();

  if (isLoading) return null;
  if (!data) return <Redirect href="/sign-in" />;
  if (!data.activeOrganizationId) return <Redirect href="/(app)/profile" />;
  return <Redirect href="/(app)/home" />;
}
```

```tsx
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { Button, Text, View } from "react-native";
import { buildAppLoginUrl } from "@/src/lib/auth/app-auth";
import { getWebappUrl } from "@/src/lib/config";
import { useMobileSession } from "@/src/features/session/use-mobile-session";

export default function SignInScreen() {
  const redirectUri = Linking.createURL("auth/callback");
  const { controller } = useMobileSession();

  return (
    <View>
      <Text>Z8 Mobile</Text>
      <Button
        title="Sign In"
        onPress={async () => {
          const result = await WebBrowser.openAuthSessionAsync(
            buildAppLoginUrl(getWebappUrl(), redirectUri),
            redirectUri,
          );

          if (result.type === "success" && result.url) {
            await controller.handleCallbackUrl(result.url);
          }
        }}
      />
    </View>
  );
}
```

```tsx
import { Pressable, Text, View } from "react-native";

export function ProfileScreen({ activeOrganizationId, organizations, onSwitchOrganization, onSignOut, isSwitching }) {
  return (
    <View>
      <Text>Active organization</Text>
      {organizations.map((organization) => (
        <Pressable
          key={organization.id}
          disabled={isSwitching || organization.id === activeOrganizationId}
          onPress={() => onSwitchOrganization(organization.id)}
        >
          <Text>{organization.name}</Text>
        </Pressable>
      ))}
      <Pressable onPress={onSignOut}>
        <Text>Sign out</Text>
      </Pressable>
    </View>
  );
}
```

- [ ] **Step 5: Re-run the session and profile tests**

Run: `pnpm --filter mobile test -- src/features/session/use-mobile-session.test.ts src/features/profile/profile-screen.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/features/session/use-mobile-session.ts apps/mobile/src/features/session/use-mobile-session.test.ts apps/mobile/app/index.tsx apps/mobile/app/sign-in.tsx apps/mobile/src/features/profile/profile-screen.tsx apps/mobile/src/features/profile/profile-screen.test.tsx apps/mobile/app/(app)/profile.tsx
git commit -m "feat: wire mobile session and profile flow"
```

### Task 4: Add the webapp mobile home and clocking API contract

**Files:**
- Create: `apps/webapp/src/app/api/mobile/home/route.ts`
- Create: `apps/webapp/src/app/api/mobile/home/route.test.ts`
- Create: `apps/webapp/src/app/api/mobile/time-clock/route.ts`
- Create: `apps/webapp/src/app/api/mobile/time-clock/route.test.ts`

- [ ] **Step 1: Write the failing mobile home and clocking route tests**

```ts
import { describe, expect, it } from "vitest";

describe("mobile home route", () => {
  it("returns clock state, today summary, and next approved absence", async () => {
    const response = await GET();
    const payload = await response.json();

    expect(payload).toMatchObject({
      activeOrganizationId: expect.anything(),
      clock: {
        isClockedIn: expect.any(Boolean),
        activeWorkPeriod: expect.anything(),
      },
      today: {
        minutesWorked: expect.any(Number),
        latestEventLabel: expect.any(String),
      },
    });
  });
});

describe("mobile time-clock route", () => {
  it("requires workLocationType when clocking in", async () => {
    const request = new Request("https://ui.z8-time.app/api/mobile/time-clock", {
      method: "POST",
      body: JSON.stringify({ action: "clock_in" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request as any);
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the focused route tests to verify they fail**

Run: `pnpm --filter webapp test -- src/app/api/mobile/home/route.test.ts src/app/api/mobile/time-clock/route.test.ts`

Expected: FAIL because the mobile home and clocking routes do not exist yet.

- [ ] **Step 3: Implement the aggregated home route**

Build a single payload tailored for the mobile `Home` screen:

```ts
import { and, desc, eq, gte } from "drizzle-orm";
import { DateTime } from "luxon";
import { NextResponse } from "next/server";
import { absenceEntry, timeEntry } from "@/db/schema";
import { db } from "@/db";
import { getTimeSummary } from "@/app/[locale]/(app)/time-tracking/actions/queries";
import { getActiveWorkPeriod } from "@/app/[locale]/(app)/time-tracking/actions/queries";
import { requireMobileSession } from "../shared";

export async function GET() {
  const mobile = await requireMobileSession();
  if ("error" in mobile) return mobile.error;

  const employee = await requireMobileEmployee(mobile.session.user.id, mobile.session.session.activeOrganizationId);
  const timezone = "UTC";
  const [activeWorkPeriod, todaySummary, latestEntry, nextAbsence] = await Promise.all([
    getActiveWorkPeriod(employee.id),
    getTimeSummary(employee.id, timezone),
    db.query.timeEntry.findFirst({
      where: and(eq(timeEntry.employeeId, employee.id), eq(timeEntry.organizationId, employee.organizationId)),
      orderBy: [desc(timeEntry.timestamp)],
    }),
    db.query.absenceEntry.findFirst({
      where: and(
        eq(absenceEntry.employeeId, employee.id),
        eq(absenceEntry.organizationId, employee.organizationId),
        eq(absenceEntry.status, "approved"),
        gte(absenceEntry.startDate, DateTime.now().toISODate()!),
      ),
      with: { category: true },
    }),
  ]);

  return NextResponse.json({
    activeOrganizationId: employee.organizationId,
    clock: {
      isClockedIn: !!activeWorkPeriod,
      activeWorkPeriod: activeWorkPeriod
        ? {
            id: activeWorkPeriod.id,
            startTime: activeWorkPeriod.startTime.toISOString(),
            workLocationType: activeWorkPeriod.workLocationType,
          }
        : null,
    },
    today: {
      minutesWorked: todaySummary.todayMinutes,
      latestEventLabel: latestEntry ? latestEntry.type : "none",
      nextApprovedAbsence: nextAbsence
        ? {
            id: nextAbsence.id,
            categoryName: nextAbsence.category.name,
            startDate: nextAbsence.startDate,
            endDate: nextAbsence.endDate,
          }
        : null,
    },
  });
}
```

- [ ] **Step 4: Implement the mobile clock in/out mutation route on top of existing clocking logic**

Reuse the existing server functions instead of re-implementing time tracking rules:

```ts
import { NextRequest, NextResponse } from "next/server";
import { clockIn, clockOut } from "@/app/[locale]/(app)/time-tracking/actions/clocking";
import { requireMobileSession } from "../shared";

export async function POST(request: NextRequest) {
  const mobile = await requireMobileSession();
  if ("error" in mobile) return mobile.error;

  const body = await request.json();
  if (body.action === "clock_in") {
    if (!body.workLocationType) {
      return NextResponse.json({ error: "workLocationType is required" }, { status: 400 });
    }

    const result = await clockIn(body.workLocationType);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  }

  if (body.action === "clock_out") {
    const result = await clockOut();
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  }

  return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
}
```

- [ ] **Step 5: Re-run the mobile home and clocking tests**

Run: `pnpm --filter webapp test -- src/app/api/mobile/home/route.test.ts src/app/api/mobile/time-clock/route.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/src/app/api/mobile/home/route.ts apps/webapp/src/app/api/mobile/home/route.test.ts apps/webapp/src/app/api/mobile/time-clock/route.ts apps/webapp/src/app/api/mobile/time-clock/route.test.ts
git commit -m "feat: add mobile home and clocking api"
```

### Task 5: Build the mobile home screen and required work-location flow

**Files:**
- Create: `apps/mobile/src/lib/api/client.ts`
- Create: `apps/mobile/src/features/home/use-home-query.ts`
- Create: `apps/mobile/src/features/home/work-location-picker.tsx`
- Create: `apps/mobile/src/features/home/home-screen.tsx`
- Create: `apps/mobile/src/features/home/home-screen.test.tsx`
- Modify: `apps/mobile/app/(app)/home.tsx`

- [ ] **Step 1: Write the failing mobile home screen test**

```tsx
import { fireEvent, render, screen } from "@testing-library/react-native";
import { describe, expect, it, vi } from "vitest";
import { HomeScreen } from "./home-screen";

describe("HomeScreen", () => {
  it("disables clock in until a work location is selected", () => {
    render(
      <HomeScreen
        data={{
          clock: { isClockedIn: false, activeWorkPeriod: null },
          today: { minutesWorked: 0, latestEventLabel: "none", nextApprovedAbsence: null },
        }}
        selectedWorkLocation={null}
        onSelectWorkLocation={() => {}}
        onClockIn={() => {}}
        onClockOut={() => {}}
        isSubmitting={false}
      />,
    );

    expect(screen.getByText("Location required")).toBeTruthy();
    expect(screen.getByText("Clock In").parent?.props.disabled).toBe(true);
  });

  it("locks the selected location while a clock-in mutation is pending", () => {
    const onSelectWorkLocation = vi.fn();

    render(
      <HomeScreen
        data={{
          clock: { isClockedIn: false, activeWorkPeriod: null },
          today: { minutesWorked: 0, latestEventLabel: "none", nextApprovedAbsence: null },
        }}
        selectedWorkLocation="home"
        onSelectWorkLocation={onSelectWorkLocation}
        onClockIn={() => {}}
        onClockOut={() => {}}
        isSubmitting={true}
      />,
    );

    fireEvent.press(screen.getByText("Home"));
    expect(onSelectWorkLocation).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the focused home screen test to verify it fails**

Run: `pnpm --filter mobile test -- src/features/home/home-screen.test.tsx`

Expected: FAIL because the shared API client and home screen do not exist yet.

- [ ] **Step 3: Implement the shared mobile API client and home query hook**

Use one fetch wrapper so every request carries the bearer token and app-type header:

```ts
import { getWebappUrl } from "@/src/lib/config";
import { MOBILE_APP_TYPE_HEADER } from "@/src/lib/auth/app-auth";

export async function apiFetch(path: string, options: { token: string; method?: string; body?: unknown } ) {
  const response = await fetch(`${getWebappUrl()}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${options.token}`,
      "Content-Type": "application/json",
      ...MOBILE_APP_TYPE_HEADER,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(payload.error || "Request failed");
  }

  return response.json();
}
```

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/src/lib/api/client";
import { useMobileSession } from "@/src/features/session/use-mobile-session";

export function useHomeQuery() {
  const { data: session } = useMobileSession();
  const queryClient = useQueryClient();
  const token = session?.token;

  const homeQuery = useQuery({
    queryKey: ["mobile-home", session?.activeOrganizationId],
    queryFn: () => apiFetch("/api/mobile/home", { token: token! }),
    enabled: !!token && !!session?.activeOrganizationId,
  });

  const clockMutation = useMutation({
    mutationFn: (body: { action: "clock_in" | "clock_out"; workLocationType?: string }) =>
      apiFetch("/api/mobile/time-clock", { token: token!, method: "POST", body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["mobile-home"] }),
  });

  return { homeQuery, clockMutation };
}
```

- [ ] **Step 4: Implement the clock-first home screen**

Build the approved mobile interaction model directly in `home-screen.tsx`:

```tsx
import { Pressable, Text, View } from "react-native";

const WORK_LOCATIONS = ["office", "home", "field", "other"] as const;

export function HomeScreen({ data, selectedWorkLocation, onSelectWorkLocation, onClockIn, onClockOut, isSubmitting }) {
  const isClockedIn = data.clock.isClockedIn;
  const canClockIn = !isClockedIn && selectedWorkLocation !== null && !isSubmitting;

  return (
    <View>
      <Text>{isClockedIn ? "Working" : "Ready to start"}</Text>
      {!isClockedIn && (
        <View>
          <Text>{selectedWorkLocation ? `From ${selectedWorkLocation}` : "Location required"}</Text>
          <View>
            {WORK_LOCATIONS.map((location) => (
              <Pressable
                key={location}
                disabled={isSubmitting}
                onPress={() => onSelectWorkLocation(location)}
              >
                <Text>{location[0].toUpperCase() + location.slice(1)}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable disabled={!canClockIn} onPress={onClockIn}>
            <Text>Clock In</Text>
          </Pressable>
        </View>
      )}
      {isClockedIn && (
        <Pressable disabled={isSubmitting} onPress={onClockOut}>
          <Text>Clock Out</Text>
        </Pressable>
      )}
      <View>
        <Text>Today</Text>
        <Text>{data.today.minutesWorked} minutes worked</Text>
        <Text>{data.today.latestEventLabel}</Text>
      </View>
    </View>
  );
}
```

- [ ] **Step 5: Re-run the mobile home screen test**

Run: `pnpm --filter mobile test -- src/features/home/home-screen.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/lib/api/client.ts apps/mobile/src/features/home/use-home-query.ts apps/mobile/src/features/home/work-location-picker.tsx apps/mobile/src/features/home/home-screen.tsx apps/mobile/src/features/home/home-screen.test.tsx apps/mobile/app/(app)/home.tsx
git commit -m "feat: add mobile home screen"
```

### Task 6: Add the webapp mobile absences API contract

**Files:**
- Create: `apps/webapp/src/app/api/mobile/absences/route.ts`
- Create: `apps/webapp/src/app/api/mobile/absences/route.test.ts`
- Create: `apps/webapp/src/app/api/mobile/absences/[absenceId]/cancel/route.ts`
- Create: `apps/webapp/src/app/api/mobile/absences/[absenceId]/cancel/route.test.ts`

- [ ] **Step 1: Write the failing mobile absence route tests**

```ts
import { describe, expect, it } from "vitest";

describe("mobile absences route", () => {
  it("returns categories and the current employee's absence entries", async () => {
    const response = await GET();
    const payload = await response.json();

    expect(payload).toMatchObject({
      categories: expect.any(Array),
      absences: expect.any(Array),
    });
  });

  it("creates a new absence request", async () => {
    const request = new Request("https://ui.z8-time.app/api/mobile/absences", {
      method: "POST",
      body: JSON.stringify({
        categoryId: "cat-1",
        startDate: "2026-04-21",
        startPeriod: "full_day",
        endDate: "2026-04-21",
        endPeriod: "full_day",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request as any);
    expect(response.status).not.toBe(404);
  });
});

describe("mobile cancel absence route", () => {
  it("rejects cancellation when the absence is not pending", async () => {
    const response = await POST(new Request("https://ui.z8-time.app/api/mobile/absences/abc/cancel", { method: "POST" }) as any, {
      params: Promise.resolve({ absenceId: "abc" }),
    } as any);

    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the focused absence route tests to verify they fail**

Run: `pnpm --filter webapp test -- src/app/api/mobile/absences/route.test.ts src/app/api/mobile/absences/[absenceId]/cancel/route.test.ts`

Expected: FAIL because the mobile absence routes do not exist yet.

- [ ] **Step 3: Implement the list and request route with the existing absence actions**

Return one payload the mobile screen can render directly:

```ts
import { DateTime } from "luxon";
import { NextRequest, NextResponse } from "next/server";
import { getAbsenceCategories, getAbsenceEntries, getVacationBalance, requestAbsence } from "@/app/[locale]/(app)/absences/actions";
import { requireMobileSession, requireMobileEmployee } from "../shared";

export async function GET() {
  const mobile = await requireMobileSession();
  if ("error" in mobile) return mobile.error;

  const employee = await requireMobileEmployee(mobile.session.user.id, mobile.session.session.activeOrganizationId);
  const year = DateTime.now().year;
  const [categories, absences, vacationBalance] = await Promise.all([
    getAbsenceCategories(employee.organizationId),
    getAbsenceEntries(employee.id, `${year}-01-01`, `${year}-12-31`),
    getVacationBalance(employee.id, year),
  ]);

  return NextResponse.json({
    categories,
    absences,
    vacationBalance,
  });
}

export async function POST(request: NextRequest) {
  const mobile = await requireMobileSession();
  if ("error" in mobile) return mobile.error;

  const body = await request.json();
  const result = await requestAbsence(body);
  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
```

- [ ] **Step 4: Implement the pending-only cancel route**

Keep the route small and let the existing absence mutation enforce permissions:

```ts
import { NextResponse } from "next/server";
import { cancelAbsenceRequest } from "@/app/[locale]/(app)/absences/actions";
import { requireMobileSession } from "../../shared";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ absenceId: string }> },
) {
  const mobile = await requireMobileSession();
  if ("error" in mobile) return mobile.error;

  const { absenceId } = await params;
  const result = await cancelAbsenceRequest(absenceId);
  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
```

- [ ] **Step 5: Re-run the mobile absence route tests**

Run: `pnpm --filter webapp test -- src/app/api/mobile/absences/route.test.ts src/app/api/mobile/absences/[absenceId]/cancel/route.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/src/app/api/mobile/absences/route.ts apps/webapp/src/app/api/mobile/absences/route.test.ts apps/webapp/src/app/api/mobile/absences/[absenceId]/cancel/route.ts apps/webapp/src/app/api/mobile/absences/[absenceId]/cancel/route.test.ts
git commit -m "feat: add mobile absences api"
```

### Task 7: Build the mobile absences screen, request flow, and final verification

**Files:**
- Create: `apps/mobile/src/features/absences/use-absences-query.ts`
- Create: `apps/mobile/src/features/absences/absences-screen.tsx`
- Create: `apps/mobile/src/features/absences/absences-screen.test.tsx`
- Create: `apps/mobile/src/features/absences/request-absence-form.ts`
- Create: `apps/mobile/src/features/absences/request-absence-screen.tsx`
- Create: `apps/mobile/src/features/absences/request-absence-screen.test.tsx`
- Modify: `apps/mobile/app/(app)/absences/index.tsx`
- Modify: `apps/mobile/app/(app)/absences/request.tsx`

- [ ] **Step 1: Write the failing mobile absences tests**

```tsx
import { fireEvent, render, screen } from "@testing-library/react-native";
import { describe, expect, it, vi } from "vitest";
import { AbsencesScreen } from "./absences-screen";
import { createRequestAbsenceForm } from "./request-absence-form";

describe("AbsencesScreen", () => {
  it("shows cancel only for pending absences", () => {
    render(
      <AbsencesScreen
        absences={[
          { id: "abs-1", status: "pending", category: { name: "Vacation" }, startDate: "2026-04-21", endDate: "2026-04-21" },
          { id: "abs-2", status: "approved", category: { name: "Sick" }, startDate: "2026-04-22", endDate: "2026-04-22" },
        ]}
        activeFilter="pending"
        onChangeFilter={() => {}}
        onRequestAbsence={() => {}}
        onCancelAbsence={() => {}}
      />,
    );

    expect(screen.getByText("Cancel request")).toBeTruthy();
    expect(screen.queryAllByText("Cancel request")).toHaveLength(1);
  });
});

describe("createRequestAbsenceForm", () => {
  it("rejects a same-day pm-to-am range", () => {
    const form = createRequestAbsenceForm();
    const result = form.validate({
      categoryId: "cat-1",
      startDate: "2026-04-21",
      startPeriod: "pm",
      endDate: "2026-04-21",
      endPeriod: "am",
      notes: "",
    });

    expect(result.endPeriod).toBe("Cannot end in the morning if starting in the afternoon on the same day");
  });
});
```

- [ ] **Step 2: Run the focused mobile absence tests to verify they fail**

Run: `pnpm --filter mobile test -- src/features/absences/absences-screen.test.tsx src/features/absences/request-absence-screen.test.tsx`

Expected: FAIL because the absences query, form, and screens do not exist yet.

- [ ] **Step 3: Implement the absences query layer and TanStack Form validation**

Keep the screen API small and mobile-friendly:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/src/lib/api/client";
import { useMobileSession } from "@/src/features/session/use-mobile-session";

export function useAbsencesQuery() {
  const { data: session } = useMobileSession();
  const queryClient = useQueryClient();
  const token = session?.token;

  const absencesQuery = useQuery({
    queryKey: ["mobile-absences", session?.activeOrganizationId],
    queryFn: () => apiFetch("/api/mobile/absences", { token: token! }),
    enabled: !!token && !!session?.activeOrganizationId,
  });

  const createMutation = useMutation({
    mutationFn: (body: unknown) => apiFetch("/api/mobile/absences", { token: token!, method: "POST", body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["mobile-absences"] }),
  });

  const cancelMutation = useMutation({
    mutationFn: (absenceId: string) => apiFetch(`/api/mobile/absences/${absenceId}/cancel`, { token: token!, method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["mobile-absences"] }),
  });

  return { absencesQuery, createMutation, cancelMutation };
}
```

```ts
export function createRequestAbsenceForm() {
  return {
    validate(value: {
      categoryId: string;
      startDate: string;
      startPeriod: "full_day" | "am" | "pm";
      endDate: string;
      endPeriod: "full_day" | "am" | "pm";
      notes: string;
    }) {
      return {
        endPeriod:
          value.startDate === value.endDate && value.startPeriod === "pm" && value.endPeriod === "am"
            ? "Cannot end in the morning if starting in the afternoon on the same day"
            : undefined,
      };
    },
  };
}
```

- [ ] **Step 4: Implement the absence list and request screens**

Keep filters and actions intentionally small:

```tsx
import { Pressable, Text, View } from "react-native";

export function AbsencesScreen({ absences, activeFilter, onChangeFilter, onRequestAbsence, onCancelAbsence }) {
  const filtered = absences.filter((absence) => {
    if (activeFilter === "pending") return absence.status === "pending";
    if (activeFilter === "upcoming") return absence.status !== "rejected" && absence.startDate >= new Date().toISOString().slice(0, 10);
    return absence.startDate < new Date().toISOString().slice(0, 10);
  });

  return (
    <View>
      <Pressable onPress={onRequestAbsence}>
        <Text>Request absence</Text>
      </Pressable>
      {filtered.map((absence) => (
        <View key={absence.id}>
          <Text>{absence.category.name}</Text>
          <Text>{absence.startDate} - {absence.endDate}</Text>
          <Text>{absence.status}</Text>
          {absence.status === "pending" && (
            <Pressable onPress={() => onCancelAbsence(absence.id)}>
              <Text>Cancel request</Text>
            </Pressable>
          )}
        </View>
      ))}
    </View>
  );
}
```

```tsx
import { useForm } from "@tanstack/react-form";
import { Pressable, Text, TextInput, View } from "react-native";

export function RequestAbsenceScreen({ categories, onSubmit }) {
  const form = useForm({
    defaultValues: {
      categoryId: "",
      startDate: "",
      startPeriod: "full_day",
      endDate: "",
      endPeriod: "full_day",
      notes: "",
    },
    onSubmit: ({ value }) => onSubmit(value),
  });

  return (
    <View>
      <Text>Request absence</Text>
      <form.Field name="categoryId">
        {(field) => (
          <TextInput
            value={field.state.value}
            onChangeText={field.handleChange}
            placeholder="Category ID"
          />
        )}
      </form.Field>
      <form.Field name="startDate">
        {(field) => (
          <TextInput
            value={field.state.value}
            onChangeText={field.handleChange}
            placeholder="YYYY-MM-DD"
          />
        )}
      </form.Field>
      <form.Field name="startPeriod">
        {(field) => (
          <TextInput
            value={field.state.value}
            onChangeText={field.handleChange}
            placeholder="full_day | am | pm"
          />
        )}
      </form.Field>
      <form.Field name="endDate">
        {(field) => (
          <TextInput
            value={field.state.value}
            onChangeText={field.handleChange}
            placeholder="YYYY-MM-DD"
          />
        )}
      </form.Field>
      <form.Field name="endPeriod">
        {(field) => (
          <TextInput
            value={field.state.value}
            onChangeText={field.handleChange}
            placeholder="full_day | am | pm"
          />
        )}
      </form.Field>
      <form.Field name="notes">
        {(field) => (
          <TextInput
            value={field.state.value}
            onChangeText={field.handleChange}
            placeholder="Notes"
          />
        )}
      </form.Field>
      <Pressable onPress={() => form.handleSubmit()}>
        <Text>Submit request</Text>
      </Pressable>
    </View>
  );
}
```

- [ ] **Step 5: Run the focused mobile absence tests and the package build**

Run: `pnpm --filter mobile test -- src/features/absences/absences-screen.test.tsx src/features/absences/request-absence-screen.test.tsx && pnpm --filter mobile build`

Expected: PASS for both tests, then a successful Expo export.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/features/absences/use-absences-query.ts apps/mobile/src/features/absences/absences-screen.tsx apps/mobile/src/features/absences/absences-screen.test.tsx apps/mobile/src/features/absences/request-absence-form.ts apps/mobile/src/features/absences/request-absence-screen.tsx apps/mobile/src/features/absences/request-absence-screen.test.tsx apps/mobile/app/(app)/absences/index.tsx apps/mobile/app/(app)/absences/request.tsx
git commit -m "feat: add mobile absence workflows"
```

## Final Verification

- Run: `pnpm --filter webapp test -- src/app/api/auth/app-login/route.test.ts src/app/api/mobile/session/route.test.ts src/app/api/mobile/home/route.test.ts src/app/api/mobile/time-clock/route.test.ts src/app/api/mobile/absences/route.test.ts src/app/api/mobile/absences/[absenceId]/cancel/route.test.ts`
  - Expected: PASS.
- Run: `pnpm --filter mobile test`
  - Expected: PASS.
- Run: `pnpm --filter mobile build`
  - Expected: PASS.
- Run: `pnpm test`
  - Expected: PASS for the workspace test pipeline.

## Spec Coverage Check

- Employee-only audience: covered by the mobile session gate, mobile-only routes, and the absence or home screens.
- Multi-organization support: covered by the session route, switch route update, and the profile screen.
- Clock-first home with required work location: covered by Tasks 4 and 5.
- Attendance-style status: covered by the aggregated home route and home screen summary.
- Self-service absences with pending cancellation: covered by Tasks 6 and 7.
- Connected-only v1: preserved by the lack of offline queue logic and the online-only API client.

## Risk Notes

- The existing desktop bearer flow uses a `desktop-login` route, but that route is not reusable as-is for mobile because it only accepts `z8://` redirects and does not use the existing `callbackUrl` login continuation path.
- The current mobile app has almost no infrastructure, so Task 1 deliberately establishes the smallest stable shell first before feature screens land.
- Full manual verification requires a reachable `EXPO_PUBLIC_WEBAPP_URL` and a local or deployed webapp session.
