# Mobile Webapp Reconnect and Expo UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore `apps/mobile` compatibility with the current webapp auth contract and convert the mobile UX broadly to `@expo/ui` components.

**Architecture:** Keep the current Expo Router, TanStack Query, and TanStack Form data flow. Add a focused PKCE utility for app auth, keep `/api/mobile/*` calls behind the existing Bearer-token API client, and convert screen content to `@expo/ui` `Host` subtrees with small React Native fallbacks only for navigation, alert behavior, and gaps in `@expo/ui`.

**Tech Stack:** Expo SDK 56, Expo Router, React Native, `@expo/ui`, `expo-crypto`, `expo-secure-store`, TanStack Query, TanStack Form, Luxon, Vitest.

---

## File Structure

- Modify `apps/mobile/package.json`: add `@expo/ui`, `expo-crypto`, and `@types/luxon`.
- Modify `pnpm-lock.yaml`: dependency lockfile updates from package commands.
- Create `apps/mobile/src/lib/auth/pkce.ts`: generate verifier/challenge pairs using Expo-compatible crypto.
- Modify `apps/mobile/src/lib/auth/app-auth.ts`: include `challenge` in login URL and send `verifier` during code exchange.
- Modify `apps/mobile/src/lib/auth/app-auth.test.ts`: test PKCE URL and exchange payload behavior.
- Modify `apps/mobile/src/features/session/use-mobile-session.ts`: require verifier when exchanging callback codes and stop relying on direct callback tokens.
- Modify `apps/mobile/src/features/session/use-mobile-session.test.ts`: update callback controller tests for verifier-based exchange.
- Modify `apps/mobile/app/sign-in.tsx`: generate PKCE before opening browser and pass verifier into callback handling.
- Create `apps/mobile/test/expo-ui-mock.tsx`: reusable Vitest mock for `@expo/ui` primitives.
- Modify `apps/mobile/test/setup.ts`: register `@expo/ui`, `@expo/ui/community/datetime-picker`, and `expo-crypto` mocks.
- Modify `apps/mobile/src/features/absences/request-absence-screen.tsx`: convert form UI toward `@expo/ui` and replace manual date text input with date picker controls.
- Modify `apps/mobile/src/features/absences/request-absence-screen.test.tsx`: add payload/date-picker behavior coverage.
- Modify `apps/mobile/src/features/home/home-screen.tsx`: convert screen body to `@expo/ui` while preserving disabled clock-in behavior.
- Modify `apps/mobile/src/features/home/work-location-picker.tsx`: convert selectable work-location controls to `@expo/ui` buttons or list rows.
- Modify `apps/mobile/src/features/profile/profile-screen.tsx`: convert organization list and sign-out action to `@expo/ui`.
- Modify `apps/mobile/src/features/schedule/schedule-screen.tsx`: convert schedule content to `@expo/ui` list/row components.
- Modify `apps/mobile/src/features/my-requests/my-requests-screen.tsx`: convert summaries, filters, and request cards to `@expo/ui` components.
- Modify `apps/mobile/src/features/absences/absences-screen.tsx`: convert filter/action/list content to `@expo/ui` components.
- Modify affected screen tests under `apps/mobile/src/features/**`: update mocks/assertions so tests validate visible text and callbacks, not React Native implementation details.

### Task 1: Install Mobile Dependencies and Test Mocks

**Files:**
- Modify: `apps/mobile/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/mobile/test/expo-ui-mock.tsx`
- Modify: `apps/mobile/test/setup.ts`

- [ ] **Step 1: Install runtime dependencies**

Run:

```bash
pnpm --dir apps/mobile exec expo install @expo/ui expo-crypto
```

Expected: `apps/mobile/package.json` gains `@expo/ui` and `expo-crypto`; `pnpm-lock.yaml` updates.

- [ ] **Step 2: Install Luxon typings**

Run:

```bash
pnpm --dir apps/mobile add -D @types/luxon
```

Expected: `apps/mobile/package.json` gains `@types/luxon` in `devDependencies`; `pnpm-lock.yaml` updates.

- [ ] **Step 3: Add an `@expo/ui` test mock**

Create `apps/mobile/test/expo-ui-mock.tsx`:

```tsx
import React from "react";

type PrimitiveProps = Record<string, unknown> & { children?: React.ReactNode };

function createPrimitive(type: string) {
	return function Primitive({ children, ...props }: PrimitiveProps) {
		return React.createElement(type, props, children);
	};
}

export const Host = createPrimitive("Host");
export const Column = createPrimitive("Column");
export const Row = createPrimitive("Row");
export const Spacer = createPrimitive("Spacer");
export const ScrollView = createPrimitive("ScrollView");
export const Text = createPrimitive("Text");

export function Button({ label, children, onPress, disabled, ...props }: PrimitiveProps & {
	label?: string;
	onPress?: () => void;
	disabled?: boolean;
}) {
	return React.createElement(
		"Button",
		{ ...props, disabled, onPress: disabled ? undefined : onPress },
		children ?? label,
	);
}

export function List({ children, ...props }: PrimitiveProps) {
	return React.createElement("List", props, children);
}

export function ListItem({ children, supportingText, onPress, ...props }: PrimitiveProps & {
	supportingText?: React.ReactNode;
	onPress?: () => void;
}) {
	return React.createElement(
		"ListItem",
		{ ...props, onPress },
		children,
		supportingText ? React.createElement("Text", {}, supportingText) : null,
	);
}

ListItem.Leading = createPrimitive("ListItemLeading");
ListItem.Supporting = createPrimitive("ListItemSupporting");
ListItem.Trailing = createPrimitive("ListItemTrailing");

export function FieldGroup({ children, ...props }: PrimitiveProps) {
	return React.createElement("FieldGroup", props, children);
}

FieldGroup.Section = createPrimitive("FieldGroupSection");
FieldGroup.SectionHeader = createPrimitive("FieldGroupSectionHeader");
FieldGroup.SectionFooter = createPrimitive("FieldGroupSectionFooter");

export function TextInput({ value, defaultValue, onChangeText, ...props }: PrimitiveProps & {
	value?: { value: string } | string;
	defaultValue?: string;
	onChangeText?: (value: string) => void;
}) {
	const resolvedValue = typeof value === "object" && value ? value.value : value;
	return React.createElement("TextInput", {
		...props,
		defaultValue,
		onChangeText,
		value: resolvedValue,
	});
}

export function useNativeState<T>(initialValue: T) {
	return { value: initialValue };
}
```

- [ ] **Step 4: Register shared mocks**

Replace `apps/mobile/test/setup.ts` with:

```ts
import React from "react";

vi.mock("@expo/ui", async () => await import("./expo-ui-mock"));

vi.mock("@expo/ui/community/datetime-picker", () => ({
	default: ({ value, onValueChange, onDismiss, testID }: {
		value: Date;
		onValueChange?: (event: unknown, selectedDate: Date) => void;
		onDismiss?: () => void;
		testID?: string;
	}) =>
		React.createElement("DateTimePicker", {
			onDismiss,
			onValueChange,
			testID,
			value,
		}),
}));

vi.mock("expo-crypto", () => ({
	CryptoDigestAlgorithm: {
		SHA256: "SHA-256",
	},
	CryptoEncoding: {
		BASE64: "base64",
	},
	digestStringAsync: vi.fn(async (_algorithm: string, value: string) => `digest:${value}`),
	getRandomBytes: vi.fn(() => new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1))),
}));
```

- [ ] **Step 5: Run existing mobile tests**

Run:

```bash
pnpm --dir apps/mobile test
```

Expected: tests pass or fail only where existing tests mock `react-native` in a way that conflicts with the new shared setup. If they fail, keep the shared setup and update individual tests in later tasks.

- [ ] **Step 6: Commit dependency and test setup changes**

Run:

```bash
git add apps/mobile/package.json pnpm-lock.yaml apps/mobile/test/setup.ts apps/mobile/test/expo-ui-mock.tsx
git commit -m "chore: add mobile expo ui test setup"
```

Expected: commit includes only dependency and test setup files.

### Task 2: Add PKCE Mobile Auth Compatibility

**Files:**
- Create: `apps/mobile/src/lib/auth/pkce.ts`
- Modify: `apps/mobile/src/lib/auth/app-auth.ts`
- Modify: `apps/mobile/src/lib/auth/app-auth.test.ts`
- Modify: `apps/mobile/src/features/session/use-mobile-session.ts`
- Modify: `apps/mobile/src/features/session/use-mobile-session.test.ts`
- Modify: `apps/mobile/app/sign-in.tsx`

- [ ] **Step 1: Add failing PKCE utility tests to `app-auth.test.ts`**

Add these imports:

```ts
import { createAppAuthPkcePair } from "./pkce";
```

Add these tests inside `describe("app auth utilities", ...)`:

```ts
it("builds the mobile app login URL with a PKCE challenge", () => {
	expect(
		buildAppLoginUrl("https://ui.z8-time.app", "z8mobile://auth/callback", "CODE-CHALLENGE"),
	).toBe(
		"https://ui.z8-time.app/api/auth/app-login?app=mobile&redirect=z8mobile%3A%2F%2Fauth%2Fcallback&challenge=CODE-CHALLENGE",
	);
});

it("exchanges a callback code with the PKCE verifier", async () => {
	const fetchMock = vi.fn().mockResolvedValue({
		ok: true,
		json: vi.fn().mockResolvedValue({ token: "session-token" }),
	});
	vi.stubGlobal("fetch", fetchMock);

	await expect(
		exchangeAppCallbackCode("one-time-code", "mobile", "CODE-VERIFIER"),
	).resolves.toBe("session-token");

	expect(fetchMock).toHaveBeenCalledWith(
		"https://ui.z8-time.app/api/auth/app-exchange",
		expect.objectContaining({
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Z8-App-Type": "mobile",
			},
			body: JSON.stringify({ code: "one-time-code", verifier: "CODE-VERIFIER" }),
		}),
	);
});

it("creates a PKCE verifier and challenge pair", async () => {
	await expect(createAppAuthPkcePair()).resolves.toEqual({
		verifier: "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA",
		challenge: "digest:AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA",
	});
});
```

Remove or update the old login URL test that expected no `challenge`, and update the existing exchange test so it expects `{ code, verifier }`.

- [ ] **Step 2: Run auth tests to verify failure**

Run:

```bash
pnpm --dir apps/mobile exec vitest run src/lib/auth/app-auth.test.ts
```

Expected: FAIL because `createAppAuthPkcePair`, the `challenge` parameter, and `verifier` exchange are not implemented yet.

- [ ] **Step 3: Implement PKCE utility**

Create `apps/mobile/src/lib/auth/pkce.ts`:

```ts
import * as Crypto from "expo-crypto";

const VERIFIER_BYTE_LENGTH = 32;

function base64ToBase64Url(value: string) {
	return value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function bytesToBase64Url(bytes: Uint8Array) {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}

	return base64ToBase64Url(globalThis.btoa(binary));
}

export async function createAppAuthPkcePair() {
	const verifier = bytesToBase64Url(Crypto.getRandomBytes(VERIFIER_BYTE_LENGTH));
	const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
		encoding: Crypto.CryptoEncoding.BASE64,
	});

	return {
		challenge: base64ToBase64Url(digest),
		verifier,
	};
}
```

- [ ] **Step 4: Update app auth helpers**

In `apps/mobile/src/lib/auth/app-auth.ts`, change `buildAppLoginUrl` and `exchangeAppCallbackCode` to:

```ts
export function buildAppLoginUrl(
	webappUrl = getWebappUrl(),
	redirectUri: string,
	challenge: string,
) {
	const loginUrl = new URL("/api/auth/app-login", `${webappUrl}/`);

	loginUrl.searchParams.set("app", "mobile");
	loginUrl.searchParams.set("redirect", redirectUri);
	loginUrl.searchParams.set("challenge", challenge);

	return loginUrl.toString();
}

export async function exchangeAppCallbackCode(
	code: string,
	app: "mobile" | "desktop",
	verifier: string,
) {
	const response = await fetch(`${getWebappUrl()}/api/auth/app-exchange`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Z8-App-Type": app,
		},
		body: JSON.stringify({ code, verifier }),
	});

	if (!response.ok) {
		throw new Error("Failed to exchange app auth code");
	}

	const payload = (await response.json()) as { token: string };
	return payload.token;
}
```

- [ ] **Step 5: Update session controller tests for verifier-based exchange**

In `apps/mobile/src/features/session/use-mobile-session.test.ts`, remove the direct callback token test and replace the exchange expectations with:

```ts
await expect(
	controller.handleCallbackUrl("z8mobile://auth/callback?code=ONE-TIME-CODE", "CODE-VERIFIER"),
).resolves.toEqual({
	error: null,
	status: "signed-in",
});

expect(exchangeAppCallbackCode).toHaveBeenCalledWith("ONE-TIME-CODE", "mobile", "CODE-VERIFIER");
expect(setStoredSessionToken).toHaveBeenCalledWith("session-token");
```

Add this test:

```ts
it("returns a recoverable auth error when a callback code has no verifier", async () => {
	extractAppCallbackResult.mockReturnValue({
		code: "ONE-TIME-CODE",
		error: null,
		token: null,
	});

	const queryClient = new QueryClient();
	const controller = createMobileSessionController(queryClient);

	await expect(
		controller.handleCallbackUrl("z8mobile://auth/callback?code=ONE-TIME-CODE"),
	).resolves.toEqual({
		error: "code_exchange_failed",
		status: "error",
	});

	expect(exchangeAppCallbackCode).not.toHaveBeenCalled();
	expect(setStoredSessionToken).not.toHaveBeenCalled();
});
```

- [ ] **Step 6: Update session controller implementation**

In `apps/mobile/src/features/session/use-mobile-session.ts`, change `handleCallbackUrl` to accept an optional verifier and stop using direct callback tokens:

```ts
async handleCallbackUrl(url: string, verifier?: string) {
	const { error, code } = extractAppCallbackResult(url);

	if (error) {
		return { error, status: "error" } satisfies MobileSessionCallbackState;
	}

	if (!code) {
		return { error: null, status: "ignored" } satisfies MobileSessionCallbackState;
	}

	if (!verifier) {
		return { error: "code_exchange_failed", status: "error" } satisfies MobileSessionCallbackState;
	}

	let resolvedToken: string;
	try {
		resolvedToken = await exchangeAppCallbackCode(code, "mobile", verifier);
	} catch {
		return { error: "code_exchange_failed", status: "error" } satisfies MobileSessionCallbackState;
	}

	await setStoredSessionToken(resolvedToken);
	await queryClient.invalidateQueries({ queryKey: MOBILE_SESSION_QUERY_KEY });

	return { error: null, status: "signed-in" } satisfies MobileSessionCallbackState;
}
```

- [ ] **Step 7: Update sign-in route to generate and pass PKCE**

In `apps/mobile/app/sign-in.tsx`, import `createAppAuthPkcePair`:

```ts
import { createAppAuthPkcePair } from "@/src/lib/auth/pkce";
```

Inside `handleSignIn`, replace the auth session URL creation with:

```ts
const redirectUri = Linking.createURL("auth/callback");
const pkce = await createAppAuthPkcePair();

const result = await WebBrowser.openAuthSessionAsync(
	buildAppLoginUrl(getWebappUrl(), redirectUri, pkce.challenge),
	redirectUri,
);

if (result.type === "success" && result.url) {
	const callbackState = await controller.handleCallbackUrl(result.url, pkce.verifier);

	if (callbackState.status === "error") {
		setSignInError(
			callbackState.error === "access_denied"
				? "Your account does not have mobile app access. Contact your administrator."
				: "Sign-in could not be completed. Please try again.",
		);
	}
}
```

- [ ] **Step 8: Run auth/session tests**

Run:

```bash
pnpm --dir apps/mobile exec vitest run src/lib/auth/app-auth.test.ts src/features/session/use-mobile-session.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit auth compatibility**

Run:

```bash
git add apps/mobile/src/lib/auth/pkce.ts apps/mobile/src/lib/auth/app-auth.ts apps/mobile/src/lib/auth/app-auth.test.ts apps/mobile/src/features/session/use-mobile-session.ts apps/mobile/src/features/session/use-mobile-session.test.ts apps/mobile/app/sign-in.tsx
git commit -m "fix: restore mobile app auth exchange"
```

Expected: commit contains only auth compatibility changes.

### Task 3: Convert Absence Request Dates to Native Date Picker

**Files:**
- Modify: `apps/mobile/src/features/absences/request-absence-screen.tsx`
- Modify: `apps/mobile/src/features/absences/request-absence-screen.test.tsx`

- [ ] **Step 1: Add date picker payload test**

In `apps/mobile/src/features/absences/request-absence-screen.test.tsx`, keep existing validator tests and add a component-level test using the existing React tree helper pattern from other screen tests. The important assertion is that date picker selection still produces `YYYY-MM-DD` payloads:

```tsx
import React from "react";
import { RequestAbsenceScreen } from "./request-absence-screen";

function findNode(node: React.ReactNode, predicate: (element: React.ReactElement<any>) => boolean): React.ReactElement<any> | null {
	if (!React.isValidElement(node)) return null;
	const element = node as React.ReactElement<any>;
	if (typeof element.type === "function") return findNode(element.type(element.props), predicate);
	if (predicate(element)) return element;
	for (const child of React.Children.toArray(element.props.children)) {
		const match = findNode(child, predicate);
		if (match) return match;
	}
	return null;
}

it("submits picker-selected dates as ISO date strings", async () => {
	const onSubmit = vi.fn().mockResolvedValue(undefined);
	const tree = RequestAbsenceScreen({
		categories: [{ id: "category-1", name: "Vacation", type: "vacation", color: "#2563eb", countsAgainstVacation: true }],
		vacationBalance: { year: 2026, totalDays: 30, usedDays: 0, pendingDays: 0, remainingDays: 30, carryoverDays: 0 },
		isSubmitting: false,
		onBack: vi.fn(),
		onSubmit,
	});

	findNode(tree, (node) => node.type === "Button" && node.props.label === "Vacation")?.props.onPress?.();
	findNode(tree, (node) => node.type === "Button" && node.props.label === "Pick start date")?.props.onPress?.();
	findNode(tree, (node) => node.type === "DateTimePicker" && node.props.testID === "start-date-picker")?.props.onValueChange?.({}, new Date("2026-05-10T00:00:00.000Z"));
	findNode(tree, (node) => node.type === "Button" && node.props.label === "Pick end date")?.props.onPress?.();
	findNode(tree, (node) => node.type === "DateTimePicker" && node.props.testID === "end-date-picker")?.props.onValueChange?.({}, new Date("2026-05-12T00:00:00.000Z"));
	await findNode(tree, (node) => node.type === "Button" && node.props.label === "Submit Request")?.props.onPress?.();

	expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
		categoryId: "category-1",
		startDate: "2026-05-10",
		endDate: "2026-05-12",
	}));
});
```

- [ ] **Step 2: Run the new absence form test to verify failure**

Run:

```bash
pnpm --dir apps/mobile exec vitest run src/features/absences/request-absence-screen.test.tsx
```

Expected: FAIL because the screen does not render date picker controls yet.

- [ ] **Step 3: Add date picker helpers in `request-absence-screen.tsx`**

Add imports:

```tsx
import { Button, Column, FieldGroup, Host, Row, Text, TextInput } from "@expo/ui";
import DateTimePicker from "@expo/ui/community/datetime-picker";
import { DateTime } from "luxon";
```

Add helpers above `RequestAbsenceScreen`:

```tsx
type DateFieldName = "startDate" | "endDate";

function isoDateToPickerDate(value: string) {
	const parsed = DateTime.fromISO(value, { zone: "utc" });
	return (parsed.isValid ? parsed : DateTime.now().setZone("utc")).startOf("day").toJSDate();
}

function pickerDateToIsoDate(value: Date) {
	return DateTime.fromJSDate(value, { zone: "utc" }).toISODate() ?? "";
}
```

- [ ] **Step 4: Replace manual start/end text inputs with picker buttons**

Inside `RequestAbsenceScreen`, add state:

```tsx
const [activeDatePicker, setActiveDatePicker] = useState<DateFieldName | null>(null);
```

Replace each date `TextInput` section with a `Button` that opens a `DateTimePicker`. The start-date section should use this shape:

```tsx
<form.Field name="startDate">
	{(field) => (
		<Column spacing={8}>
			<Text textStyle={styles.labelText}>Start date</Text>
			<Row spacing={8} alignment="center">
				<Text>{field.state.value || "No date selected"}</Text>
				<Button label="Pick start date" variant="outlined" onPress={() => setActiveDatePicker("startDate")} />
			</Row>
			{activeDatePicker === "startDate" ? (
				<DateTimePicker
					testID="start-date-picker"
					value={isoDateToPickerDate(field.state.value)}
					mode="date"
					presentation="dialog"
					onDismiss={() => setActiveDatePicker(null)}
					onValueChange={(_event, selectedDate) => {
						field.handleChange(pickerDateToIsoDate(selectedDate));
						setValidationErrors((current) => ({ ...current, startDate: undefined }));
						setActiveDatePicker(null);
					}}
				/>
			) : null}
			{validationErrors.startDate ? <Text textStyle={styles.errorText}>{validationErrors.startDate}</Text> : null}
		</Column>
	)}
</form.Field>
```

Use the same pattern for end date with labels `End date`, `Pick end date`, `testID="end-date-picker"`, and `setValidationErrors((current) => ({ ...current, endDate: undefined, endPeriod: undefined }))`.

- [ ] **Step 5: Convert the rest of request form content to `@expo/ui`**

Wrap the returned content in one `Host` and use `FieldGroup` sections:

```tsx
return (
	<Host style={styles.host}>
		<FieldGroup>
			<FieldGroup.Section title="Request absence">
				<Text>Submit a time-off request</Text>
				<Text>{`Remaining vacation: ${vacationBalance.remainingDays} days`}</Text>
			</FieldGroup.Section>
			<FieldGroup.Section title="Details">
				{/* category, date, period, notes fields */}
			</FieldGroup.Section>
			<FieldGroup.Section title="Actions">
				<Row spacing={8}>
					<Button label="Back" variant="outlined" onPress={onBack} />
					<Button label={isSubmitting ? "Submitting..." : "Submit Request"} disabled={isSubmitting} onPress={() => void form.handleSubmit()} />
				</Row>
			</FieldGroup.Section>
		</FieldGroup>
	</Host>
);
```

Keep `TextInput` for notes with `defaultValue={field.state.value}` and `onChangeText={field.handleChange}` because notes remain free text.

- [ ] **Step 6: Run absence form tests**

Run:

```bash
pnpm --dir apps/mobile exec vitest run src/features/absences/request-absence-screen.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit absence date picker UX**

Run:

```bash
git add apps/mobile/src/features/absences/request-absence-screen.tsx apps/mobile/src/features/absences/request-absence-screen.test.tsx
git commit -m "feat: use native mobile absence date picker"
```

Expected: commit contains only request absence screen and tests.

### Task 4: Convert Sign-In, Home, Work Location, and Profile Screens to Expo UI

**Files:**
- Modify: `apps/mobile/app/sign-in.tsx`
- Modify: `apps/mobile/src/features/home/home-screen.tsx`
- Modify: `apps/mobile/src/features/home/work-location-picker.tsx`
- Modify: `apps/mobile/src/features/home/home-screen.test.tsx`
- Modify: `apps/mobile/src/features/profile/profile-screen.tsx`
- Modify: `apps/mobile/src/features/profile/profile-screen.test.tsx`

- [ ] **Step 1: Update tests to look for `Button` instead of `Pressable`**

In `home-screen.test.tsx` and `profile-screen.test.tsx`, remove local `react-native` mocks that map `Pressable`. Use shared `@expo/ui` mocks from setup. Replace predicates like `node.type === "Pressable"` with `node.type === "Button" || node.type === "ListItem"` depending on the control.

For the clock-in button assertion, use:

```ts
const clockInButton = findNode(
	tree,
	(node) => node.type === "Button" && getTextContent(node).includes("Clock In"),
);
expect(clockInButton?.props.disabled).toBe(true);
```

For profile organization switching, use:

```ts
const otherOrganizationButton = findNode(
	tree,
	(node) => node.type === "ListItem" && getTextContent(node).includes("Beta Org"),
);
otherOrganizationButton?.props.onPress?.();
expect(onSwitchOrganization).toHaveBeenCalledWith("org-2");
```

- [ ] **Step 2: Run focused tests to verify failure**

Run:

```bash
pnpm --dir apps/mobile exec vitest run src/features/home/home-screen.test.tsx src/features/profile/profile-screen.test.tsx
```

Expected: FAIL until screens render `@expo/ui` primitives.

- [ ] **Step 3: Convert sign-in screen content**

In `apps/mobile/app/sign-in.tsx`, import `Host`, `Column`, `Text`, and `Button` from `@expo/ui`; keep `StyleSheet` from `react-native` only for host styles if needed. Replace the returned `View`/`Pressable` tree with:

```tsx
return (
	<Host style={styles.container}>
		<Column spacing={12} alignment="center">
			<Text textStyle={styles.titleText}>Sign In</Text>
			<Text textStyle={styles.subtitleText}>Continue in the browser to connect your Z8 account.</Text>
			{signInError ? <Text textStyle={styles.errorText}>{signInError}</Text> : null}
			<Button
				label={isStartingSignIn ? "Opening Browser..." : "Continue in Browser"}
				disabled={isStartingSignIn || routeState === "loading"}
				onPress={handleSignIn}
			/>
		</Column>
	</Host>
);
```

- [ ] **Step 4: Convert `WorkLocationPicker`**

Replace `Pressable` chips with `Button` controls:

```tsx
import { Button, Column, Row, Text } from "@expo/ui";

export function WorkLocationPicker({ selectedValue, disabled, onChange }: WorkLocationPickerProps) {
	return (
		<Column spacing={10}>
			<Text textStyle={styles.labelText}>Work location</Text>
			<Row spacing={8}>
				{WORK_LOCATION_OPTIONS.map((option) => {
					const isSelected = option.value === selectedValue;
					return (
						<Button
							key={option.value}
							label={isSelected ? `${option.label} selected` : option.label}
							variant={isSelected ? "filled" : "outlined"}
							disabled={disabled}
							onPress={() => onChange(option.value)}
						/>
					);
				})}
			</Row>
		</Column>
	);
}
```

- [ ] **Step 5: Convert `HomeScreen`**

Use `Host`, `Column`, `Row`, `Text`, and `Button`. Preserve the disabled behavior:

```tsx
<Button
	label={actionLabel}
	disabled={isClockedIn ? isSubmitting : isClockInDisabled}
	onPress={isClockedIn ? onClockOut : onClockIn}
/>
```

Keep visible text unchanged: `Today`, `Ready to start work`, `You are clocked in`, `Today summary`, `Minutes worked`, and `Latest event`.

- [ ] **Step 6: Convert `ProfileScreen`**

Use `Host`, `FieldGroup`, `List`, `ListItem`, `Text`, and `Button`. Organization rows should be `ListItem` with `supportingText` and `onPress` omitted when disabled:

```tsx
<ListItem
	key={organization.id}
	supportingText={isActive ? "Current organization" : !isUnavailable ? "Available for mobile time tracking" : "No employee record"}
	onPress={isDisabled ? undefined : () => onSwitchOrganization(organization.id)}
>
	{organization.name}
</ListItem>
```

Use a `Button` for sign out:

```tsx
<Button label="Sign out" variant="outlined" disabled={isSigningOut} onPress={onSignOut} />
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
pnpm --dir apps/mobile exec vitest run src/features/home/home-screen.test.tsx src/features/profile/profile-screen.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit converted core screens**

Run:

```bash
git add apps/mobile/app/sign-in.tsx apps/mobile/src/features/home/home-screen.tsx apps/mobile/src/features/home/work-location-picker.tsx apps/mobile/src/features/home/home-screen.test.tsx apps/mobile/src/features/profile/profile-screen.tsx apps/mobile/src/features/profile/profile-screen.test.tsx
git commit -m "feat: convert core mobile screens to expo ui"
```

Expected: commit contains sign-in, home, work-location, profile, and related tests.

### Task 5: Convert Schedule, Requests, and Absences Screens to Expo UI

**Files:**
- Modify: `apps/mobile/src/features/schedule/schedule-screen.tsx`
- Modify: `apps/mobile/src/features/schedule/schedule-screen.test.tsx`
- Modify: `apps/mobile/src/features/my-requests/my-requests-screen.tsx`
- Modify: `apps/mobile/src/features/my-requests/my-requests-screen.test.tsx`
- Modify: `apps/mobile/src/features/absences/absences-screen.tsx`
- Modify: `apps/mobile/src/features/absences/absences-screen.test.tsx`

- [ ] **Step 1: Update tests to use shared `@expo/ui` mocks**

Remove per-file `react-native` mocks for converted components. Keep `Alert` mocked in `absences-screen.test.tsx` because cancellation confirmation still uses React Native `Alert`.

For schedule, replace the scroll-view implementation assertion with a content assertion:

```ts
expect(html).toContain("Schedule");
expect(html).toContain("Next shift: Apr 12, 2026, 9:00 AM to 5:00 PM");
```

For request filters and absence filters, assert that the visible filter labels remain present and that invoking the mocked `Button`/`ListItem` `onPress` changes the rendered tree or calls the expected callback.

- [ ] **Step 2: Run focused tests to verify failure**

Run:

```bash
pnpm --dir apps/mobile exec vitest run src/features/schedule/schedule-screen.test.tsx src/features/my-requests/my-requests-screen.test.tsx src/features/absences/absences-screen.test.tsx
```

Expected: FAIL where tests expect `@expo/ui` primitives before conversion.

- [ ] **Step 3: Convert `ScheduleScreen`**

Use `Host`, `Column`, `Row`, `List`, `ListItem`, `Text`, and `Button`. Keep all formatter functions unchanged. Replace `ActionButton` with direct `Button` usage:

```tsx
<Row spacing={8}>
	<Button label="Request Absence" onPress={onRequestAbsence} />
	<Button label="View Requests" variant="outlined" onPress={onViewRequests} />
</Row>
```

Render shifts with `ListItem`:

```tsx
<ListItem supportingText={formatTimeRange(shift)} trailing={<Text>{formatStatus(shift.status)}</Text>}>
	{formatDate(shift.date)}
</ListItem>
```

Render effective schedule days with `ListItem`:

```tsx
<ListItem supportingText={day.isWorkDay ? `${day.hoursPerDay} hours` : "Non-work day"}>
	{formatDayName(day.dayOfWeek)}
</ListItem>
```

- [ ] **Step 4: Convert `MyRequestsScreen`**

Use `Host`, `Column`, `Row`, `List`, `ListItem`, `Text`, and `Button`. Keep `filterRequests`, `isRecentlyDecided`, and format helpers unchanged. Convert filter chips to buttons:

```tsx
<Button
	label={option.label}
	variant={isActive ? "filled" : "outlined"}
	onPress={() => onSelect(option.value)}
/>
```

Convert each request card to a `ListItem`:

```tsx
<ListItem
	supportingText={`${formatSourceType(request.sourceType)} · Submitted ${formatDate(request.submittedAt)}`}
	trailing={<Text>{formatStatus(request.status)}</Text>}
>
	{request.title}
</ListItem>
```

Keep decision reason visible below the row when present:

```tsx
{request.decisionReason ? <Text>{`Decision reason: ${request.decisionReason}`}</Text> : null}
```

- [ ] **Step 5: Convert `AbsencesScreen`**

Use `Host`, `Column`, `Row`, `List`, `ListItem`, `Text`, and `Button`. Keep `Alert.alert` for cancellation confirmation. Convert filter chips to `Button` variants. Render absence rows as `ListItem` with status trailing text:

```tsx
<ListItem supportingText={formatDateRange(absence)} trailing={<Text>{formatStatus(absence.status)}</Text>}>
	{absence.category.name}
</ListItem>
```

For pending absences, keep a native-looking `Button` under the row:

```tsx
{isPending ? (
	<Button
		label={isCancellingCurrent ? "Cancelling..." : "Cancel Request"}
		variant="outlined"
		disabled={isCancellingAbsence}
		onPress={() => handleCancelAbsence(absence.id, absence.category.name)}
	/>
) : null}
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm --dir apps/mobile exec vitest run src/features/schedule/schedule-screen.test.tsx src/features/my-requests/my-requests-screen.test.tsx src/features/absences/absences-screen.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit converted secondary screens**

Run:

```bash
git add apps/mobile/src/features/schedule/schedule-screen.tsx apps/mobile/src/features/schedule/schedule-screen.test.tsx apps/mobile/src/features/my-requests/my-requests-screen.tsx apps/mobile/src/features/my-requests/my-requests-screen.test.tsx apps/mobile/src/features/absences/absences-screen.tsx apps/mobile/src/features/absences/absences-screen.test.tsx
git commit -m "feat: convert mobile lists to expo ui"
```

Expected: commit contains schedule, requests, absences, and related tests.

### Task 6: Full Mobile Verification and Cleanup

**Files:**
- Modify only files needed to fix verification failures.

- [ ] **Step 1: Run full mobile tests**

Run:

```bash
pnpm --dir apps/mobile test
```

Expected: all mobile tests pass.

- [ ] **Step 2: Run mobile typecheck**

Run:

```bash
pnpm --dir apps/mobile exec tsc --noEmit
```

Expected: no TypeScript errors. The previous Luxon type errors should be gone because `@types/luxon` is installed.

- [ ] **Step 3: Run mobile export build**

Run:

```bash
pnpm --dir apps/mobile build
```

Expected: Expo export completes successfully.

- [ ] **Step 4: Inspect changes**

Run:

```bash
git status --short
git diff --stat
```

Expected: only mobile files, mobile dependencies, and lockfile changes are present. Existing unrelated extension changes may still appear in `git status`; do not stage or modify them.

- [ ] **Step 5: Commit verification fixes if any were needed**

If Step 1, 2, or 3 required fixes, commit only those fixes:

```bash
git add apps/mobile pnpm-lock.yaml
git commit -m "fix: stabilize mobile expo ui conversion"
```

Expected: commit contains only verification-related mobile fixes. If no fixes were needed after Task 5, skip this commit.

- [ ] **Step 6: Final verification evidence**

Run again after the final commit or after deciding no final commit is needed:

```bash
pnpm --dir apps/mobile test
pnpm --dir apps/mobile exec tsc --noEmit
pnpm --dir apps/mobile build
```

Expected: all three commands succeed. Record the exact passing output in the implementation summary.

## Self-Review Notes

- Spec coverage: Tasks 1-2 cover auth compatibility and Luxon typechecking. Task 3 covers native absence date picking. Tasks 4-5 cover broad `@expo/ui` screen conversion with fallbacks for Expo Router and Alert. Task 6 covers tests, typecheck, and build verification.
- Placeholder scan: The plan contains no unfinished markers or unspecified implementation steps. Conditional branches are limited to explicit verification outcomes.
- Type consistency: `buildAppLoginUrl(webappUrl, redirectUri, challenge)`, `exchangeAppCallbackCode(code, app, verifier)`, and `handleCallbackUrl(url, verifier?)` are used consistently across tasks.
