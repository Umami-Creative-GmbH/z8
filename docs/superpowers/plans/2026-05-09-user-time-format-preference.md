# User Time Format Preference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-user 12h/24h time format preference that drives time pickers and user-facing clock-time displays while keeping stored values normalized.

**Architecture:** Store the preference on `user_settings`, mirror the existing week-start preference flow, and expose small helpers for validation and display formatting. Keep `TimeInput` as the single picker integration point and keep forms/server actions using `HH:mm` values.

**Tech Stack:** Next.js 16, React 19, TypeScript, Drizzle ORM, Effect services, TanStack Form, Vitest, Testing Library, `timepicker-ui`, pnpm.

---

## File Map

- Create `apps/webapp/src/lib/user-preferences/time-format.ts`: user preference type, defaults, option labels, normalization, `Intl.DateTimeFormat` options, and `HH:mm` string display formatting.
- Create `apps/webapp/src/lib/user-preferences/time-format.test.ts`: helper coverage for normalization and display formatting.
- Create `apps/webapp/src/lib/user-preferences/time-format-server.ts`: authenticated/server-side lookup equivalent to `week-start-server.ts`.
- Modify `apps/webapp/src/db/schema/user-settings.ts`: add `timeFormat` text column with default `24h`.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/profile/actions.ts`: add `updateTimeFormat()` and `getTimeFormat()` server actions.
- Create `apps/webapp/src/components/settings/time-format-settings.tsx`: profile settings card mirroring `WeekStartSettings`.
- Create `apps/webapp/src/components/settings/time-format-settings.test.tsx`: profile settings UI test.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/profile/page.tsx`: fetch and render time format settings.
- Modify `apps/webapp/src/lib/validations/onboarding.ts`: add `timeFormat` to onboarding profile schema.
- Modify `apps/webapp/src/app/[locale]/onboarding/profile/page.tsx`: add time format field to onboarding form.
- Modify `apps/webapp/src/app/[locale]/onboarding/profile/page.test.tsx`: assert default submitted preference.
- Modify `apps/webapp/src/app/[locale]/onboarding/profile/actions.test.ts`: assert schema default and invalid rejection.
- Modify `apps/webapp/src/lib/effect/services/onboarding.service.ts`: validate and persist `timeFormat`.
- Modify `apps/webapp/src/lib/effect/services/onboarding.service.test.ts`: assert persisted and invalid values.
- Modify `apps/webapp/src/components/ui/time-input.tsx`: add `timeFormat` prop, picker mode selection, and read-only/manual-input prevention.
- Modify `apps/webapp/src/components/ui/time-input.test.tsx`: assert read-only behavior and picker mode.
- Modify representative display components: `apps/webapp/src/components/time-tracking/clock-in-out-widget-parts.tsx` and `apps/webapp/src/components/time-tracking/time-clock-popover.tsx`.
- Cover display formatting through `time-format.test.ts`; verify component type compatibility with the final build command.

## Task 1: Add Time Format Preference Helpers And Schema

**Files:**
- Create: `apps/webapp/src/lib/user-preferences/time-format.ts`
- Create: `apps/webapp/src/lib/user-preferences/time-format.test.ts`
- Create: `apps/webapp/src/lib/user-preferences/time-format-server.ts`
- Modify: `apps/webapp/src/db/schema/user-settings.ts`

- [ ] **Step 1: Write failing helper tests**

Add `apps/webapp/src/lib/user-preferences/time-format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	formatTimeStringForPreference,
	getTimeFormatDateTimeOptions,
	normalizeTimeFormat,
} from "./time-format";

describe("time format preferences", () => {
	it("defaults unknown values to 24h", () => {
		expect(normalizeTimeFormat(null)).toBe("24h");
		expect(normalizeTimeFormat(undefined)).toBe("24h");
		expect(normalizeTimeFormat("locale")).toBe("24h");
	});

	it("accepts 12h and 24h", () => {
		expect(normalizeTimeFormat("12h")).toBe("12h");
		expect(normalizeTimeFormat("24h")).toBe("24h");
	});

	it("returns Intl options for the selected format", () => {
		expect(getTimeFormatDateTimeOptions("24h")).toEqual({
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
		});
		expect(getTimeFormatDateTimeOptions("12h")).toEqual({
			hour: "numeric",
			minute: "2-digit",
			hour12: true,
		});
	});

	it("formats stored HH:mm strings without changing storage values", () => {
		expect(formatTimeStringForPreference("08:00", "24h")).toBe("08:00");
		expect(formatTimeStringForPreference("17:30", "24h")).toBe("17:30");
		expect(formatTimeStringForPreference("08:00", "12h")).toBe("8:00 AM");
		expect(formatTimeStringForPreference("17:30", "12h")).toBe("5:30 PM");
	});

	it("returns invalid HH:mm strings unchanged", () => {
		expect(formatTimeStringForPreference("open", "12h")).toBe("open");
		expect(formatTimeStringForPreference("25:99", "12h")).toBe("25:99");
	});
});
```

- [ ] **Step 2: Run helper tests to verify they fail**

Run: `pnpm --filter webapp test -- src/lib/user-preferences/time-format.test.ts`

Expected: FAIL because `./time-format` does not exist.

- [ ] **Step 3: Implement helper module**

Create `apps/webapp/src/lib/user-preferences/time-format.ts`:

```ts
export type TimeFormat = "24h" | "12h";

export const DEFAULT_TIME_FORMAT: TimeFormat = "24h";

export const TIME_FORMAT_OPTIONS: Array<{ value: TimeFormat; label: string; example: string }> = [
	{ value: "24h", label: "24-hour", example: "08:00" },
	{ value: "12h", label: "12-hour", example: "8:00 AM" },
];

export function isTimeFormat(value: unknown): value is TimeFormat {
	return value === "24h" || value === "12h";
}

export function normalizeTimeFormat(value: unknown): TimeFormat {
	return isTimeFormat(value) ? value : DEFAULT_TIME_FORMAT;
}

export function timeFormatToPickerType(timeFormat: TimeFormat): "24h" | "12h" {
	return timeFormat;
}

export function getTimeFormatDateTimeOptions(timeFormat: TimeFormat): Intl.DateTimeFormatOptions {
	return timeFormat === "12h"
		? { hour: "numeric", minute: "2-digit", hour12: true }
		: { hour: "2-digit", minute: "2-digit", hour12: false };
}

export function formatTimeStringForPreference(value: string, timeFormat: TimeFormat): string {
	const match = /^(\d{2}):(\d{2})$/.exec(value);
	if (!match) {
		return value;
	}

	const hour = Number(match[1]);
	const minute = Number(match[2]);
	if (hour > 23 || minute > 59) {
		return value;
	}

	if (timeFormat === "24h") {
		return value;
	}

	const suffix = hour >= 12 ? "PM" : "AM";
	const displayHour = hour % 12 || 12;
	return `${displayHour}:${match[2]} ${suffix}`;
}
```

- [ ] **Step 4: Add server lookup helper**

Create `apps/webapp/src/lib/user-preferences/time-format-server.ts`:

```ts
"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userSettings } from "@/db/schema";
import { normalizeTimeFormat, type TimeFormat } from "./time-format";

export async function getUserTimeFormat(userId: string): Promise<TimeFormat> {
	const settings = await db.query.userSettings.findFirst({
		where: eq(userSettings.userId, userId),
		columns: { timeFormat: true },
	});

	return normalizeTimeFormat(settings?.timeFormat);
}
```

- [ ] **Step 5: Add schema column**

Modify `apps/webapp/src/db/schema/user-settings.ts` near `weekStartDay`:

```ts
		// User preferences
		timezone: text("timezone").default("UTC").notNull(), // e.g., "UTC", "America/New_York"
		weekStartDay: text("week_start_day").default("sunday").notNull(),
		timeFormat: text("time_format").default("24h").notNull(),
		locale: text("locale"), // e.g., "en", "de" — null means auto-detect
```

- [ ] **Step 6: Run helper tests to verify they pass**

Run: `pnpm --filter webapp test -- src/lib/user-preferences/time-format.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add apps/webapp/src/lib/user-preferences/time-format.ts apps/webapp/src/lib/user-preferences/time-format.test.ts apps/webapp/src/lib/user-preferences/time-format-server.ts apps/webapp/src/db/schema/user-settings.ts
git commit -m "feat: add user time format preference helpers"
```

## Task 2: Add Profile Time Format Settings

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/profile/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/profile/page.tsx`
- Create: `apps/webapp/src/components/settings/time-format-settings.tsx`
- Create: `apps/webapp/src/components/settings/time-format-settings.test.tsx`

- [ ] **Step 1: Write failing settings component test**

Create `apps/webapp/src/components/settings/time-format-settings.test.tsx`:

```tsx
/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TimeFormatSettings } from "./time-format-settings";

const refreshMock = vi.fn();

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: refreshMock }),
}));

describe("TimeFormatSettings", () => {
	it("saves a changed time format", async () => {
		const onUpdate = vi.fn().mockResolvedValue({ success: true, data: undefined });

		render(<TimeFormatSettings currentTimeFormat="24h" onUpdate={onUpdate} />);

		fireEvent.click(screen.getByRole("combobox", { name: "Time format" }));
		fireEvent.click(screen.getByRole("option", { name: "12-hour (8:00 AM)" }));
		fireEvent.click(screen.getByRole("button", { name: "Save Time Format" }));

		await waitFor(() => {
			expect(onUpdate).toHaveBeenCalledWith("12h");
		});
		expect(refreshMock).toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Run component test to verify it fails**

Run: `pnpm --filter webapp test -- src/components/settings/time-format-settings.test.tsx`

Expected: FAIL because `time-format-settings.tsx` does not exist.

- [ ] **Step 3: Implement settings card**

Create `apps/webapp/src/components/settings/time-format-settings.tsx`:

```tsx
"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ServerActionResult } from "@/lib/effect/result";
import { normalizeTimeFormat, TIME_FORMAT_OPTIONS, type TimeFormat } from "@/lib/user-preferences/time-format";
import { useRouter } from "@/navigation";

interface TimeFormatSettingsProps {
	currentTimeFormat?: string | null;
	onUpdate: (timeFormat: TimeFormat) => Promise<ServerActionResult<void>>;
}

export function TimeFormatSettings({ currentTimeFormat, onUpdate }: TimeFormatSettingsProps) {
	const { t } = useTranslate();
	const { refresh } = useRouter();
	const normalizedCurrent = normalizeTimeFormat(currentTimeFormat);
	const [timeFormat, setTimeFormat] = useState<TimeFormat>(normalizedCurrent);
	const [isLoading, setIsLoading] = useState(false);
	const hasChanged = timeFormat !== normalizedCurrent;

	const handleSave = async () => {
		setIsLoading(true);
		const result = await onUpdate(timeFormat).then(
			(response) => response,
			() => null,
		);

		if (!result) {
			toast.error(t("settings.timeFormat.updateError", "An error occurred while updating time format"));
			setIsLoading(false);
			return;
		}

		if (result.success) {
			toast.success(t("settings.timeFormat.updateSuccess", "Time format updated successfully"));
			refresh();
		} else {
			toast.error(result.error || t("settings.timeFormat.updateFailed", "Failed to update time format"));
		}

		setIsLoading(false);
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("settings.timeFormat.title", "Time Format")}</CardTitle>
				<CardDescription>
					{t("settings.timeFormat.description", "Choose how clock times are shown across the app.")}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="space-y-2">
					<Label htmlFor="time-format">{t("settings.timeFormat.label", "Time format")}</Label>
					<Select
						value={timeFormat}
						onValueChange={(value) => setTimeFormat(normalizeTimeFormat(value))}
						disabled={isLoading}
					>
						<SelectTrigger id="time-format" className="w-full" aria-label={t("settings.timeFormat.label", "Time format")}>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{TIME_FORMAT_OPTIONS.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{option.value === "24h"
										? t("settings.timeFormat.options.24h", "24-hour (08:00)")
										: t("settings.timeFormat.options.12h", "12-hour (8:00 AM)")}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				{hasChanged && (
					<Button onClick={handleSave} disabled={isLoading} className="w-full">
						{isLoading && <IconLoader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
						{t("settings.timeFormat.save", "Save Time Format")}
					</Button>
				)}
			</CardContent>
		</Card>
	);
}
```

- [ ] **Step 4: Add profile server actions**

Modify imports in `apps/webapp/src/app/[locale]/(app)/settings/profile/actions.ts`:

```ts
import { isTimeFormat, normalizeTimeFormat, type TimeFormat } from "@/lib/user-preferences/time-format";
import { getUserTimeFormat } from "@/lib/user-preferences/time-format-server";
```

Append after `getWeekStartDay()`:

```ts
export async function updateTimeFormat(timeFormat: TimeFormat): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);
		if (!isTimeFormat(timeFormat)) {
			return yield* _(
				Effect.fail(
					new ValidationError({
						message: "Time format must be 12h or 24h",
						field: "timeFormat",
					}),
				),
			);
		}

		yield* _(
			dbService.query("updateTimeFormat", async () => {
				await dbService.db
					.insert(userSettings)
					.values({
						userId: session.user.id,
						timeFormat,
					})
					.onConflictDoUpdate({
						target: userSettings.userId,
						set: { timeFormat },
					});
			}),
		);
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function getTimeFormat(): Promise<TimeFormat> {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return normalizeTimeFormat(null);
	}

	return getUserTimeFormat(session.user.id);
}
```

- [ ] **Step 5: Render settings card on profile page**

Modify `apps/webapp/src/app/[locale]/(app)/settings/profile/page.tsx`:

```tsx
import { TimeFormatSettings } from "@/components/settings/time-format-settings";
import { TimezoneSettings } from "@/components/settings/timezone-settings";
import { WeekStartSettings } from "@/components/settings/week-start-settings";
import { requireUser } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import {
	getCurrentTimezone,
	getTimeFormat,
	getWeekStartDay,
	updateTimeFormat,
	updateTimezone,
	updateWeekStartDay,
} from "./actions";

export default async function ProfilePage() {
	const [authContext, currentTimezone, currentWeekStartDay, currentTimeFormat, t] = await Promise.all([
		requireUser(),
		getCurrentTimezone(),
		getWeekStartDay(),
		getTimeFormat(),
		getTranslate(),
	]);

	return (
		<div className="p-6">
			<div className="mx-auto max-w-2xl space-y-6">
				<div>
					<h1 className="text-2xl font-semibold">{t("settings.profile.title", "Profile Settings")}</h1>
					<p className="text-muted-foreground">
						{t("settings.profile.description", "Manage your personal information and preferences")}
					</p>
				</div>

				<ProfileForm user={authContext.user} />

				<TimezoneSettings currentTimezone={currentTimezone} onUpdate={updateTimezone} />
				<WeekStartSettings currentWeekStartDay={currentWeekStartDay} onUpdate={updateWeekStartDay} />
				<TimeFormatSettings currentTimeFormat={currentTimeFormat} onUpdate={updateTimeFormat} />
			</div>
		</div>
	);
}
```

- [ ] **Step 6: Run profile settings tests**

Run: `pnpm --filter webapp test -- src/components/settings/time-format-settings.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add apps/webapp/src/app/[locale]/(app)/settings/profile/actions.ts apps/webapp/src/app/[locale]/(app)/settings/profile/page.tsx apps/webapp/src/components/settings/time-format-settings.tsx apps/webapp/src/components/settings/time-format-settings.test.tsx
git commit -m "feat: add profile time format setting"
```

## Task 3: Add Onboarding Time Format Preference

**Files:**
- Modify: `apps/webapp/src/lib/validations/onboarding.ts`
- Modify: `apps/webapp/src/app/[locale]/onboarding/profile/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/onboarding/profile/page.test.tsx`
- Modify: `apps/webapp/src/app/[locale]/onboarding/profile/actions.test.ts`
- Modify: `apps/webapp/src/lib/effect/services/onboarding.service.ts`
- Modify: `apps/webapp/src/lib/effect/services/onboarding.service.test.ts`

- [ ] **Step 1: Update onboarding tests first**

In `apps/webapp/src/app/[locale]/onboarding/profile/page.test.tsx`, change the test name and expectation:

```tsx
it("renders user display preferences and submits the default values", async () => {
	updateProfileOnboardingMock.mockResolvedValue({
		success: true,
		data: { nextStep: "/onboarding/organization" },
	});

	render(<ProfilePage />);

	expect(screen.getByText("First day of the week")).toBeTruthy();
	expect(screen.getByText("Time format")).toBeTruthy();
	expect(screen.getByText("This controls how calendars and weekly summaries are displayed.")).toBeTruthy();
	expect(screen.getByText("This controls how clock times are displayed.")).toBeTruthy();

	fireEvent.change(screen.getByPlaceholderText("John"), { target: { value: "Ada" } });
	fireEvent.change(screen.getByPlaceholderText("Doe"), { target: { value: "Lovelace" } });
	fireEvent.click(screen.getByRole("button", { name: "Continue" }));

	await waitFor(() => {
		expect(updateProfileOnboardingMock).toHaveBeenCalledWith(
			expect.objectContaining({
				firstName: "Ada",
				lastName: "Lovelace",
				weekStartDay: "sunday",
				timeFormat: "24h",
			}),
		);
	});
});
```

In `apps/webapp/src/app/[locale]/onboarding/profile/actions.test.ts`, update the first test and add invalid coverage:

```ts
it("applies preference defaults before updating the profile", async () => {
	updateProfileMock.mockReturnValue(Effect.succeed({ nextStep: "/onboarding/wellness" }));

	await updateProfileOnboarding({
		firstName: "Ada",
		lastName: "Lovelace",
	} as OnboardingProfileFormValues);

	expect(updateProfileMock).toHaveBeenCalledWith(
		expect.objectContaining({ weekStartDay: "sunday", timeFormat: "24h" }),
	);
});

it("rejects invalid time format values before updating the profile", async () => {
	const result = await updateProfileOnboarding({
		firstName: "Ada",
		lastName: "Lovelace",
		weekStartDay: "sunday",
		timeFormat: "locale",
	} as unknown as OnboardingProfileFormValues);

	expect(result.success).toBe(false);
	expect(updateProfileMock).not.toHaveBeenCalled();
});
```

In `apps/webapp/src/lib/effect/services/onboarding.service.test.ts`, update the persistence test and add invalid service coverage:

```ts
it("persists the selected display preferences in user settings", async () => {
	const insertedValues = vi.fn();
	const conflictUpdate = vi.fn();
	const mockDb = {
		query: { employee: { findFirst: vi.fn(async () => null) } },
		insert: vi.fn(() => ({
			values: (values: unknown) => {
				insertedValues(values);
				return { onConflictDoUpdate: async (config: unknown) => conflictUpdate(config) };
			},
		})),
	};

	const authLayer = Layer.succeed(
		AuthService,
		AuthService.of({
			getSession: () => Effect.succeed({ user: { id: "user-1" }, session: { activeOrganizationId: null } } as never),
		}),
	);
	const dbLayer = Layer.succeed(
		DatabaseService,
		DatabaseService.of({ db: mockDb as never, query: (_name, query) => Effect.promise(query) as never }),
	);
	const layer = OnboardingServiceLive.pipe(Layer.provide(authLayer), Layer.provide(dbLayer));

	await Effect.runPromise(
		Effect.gen(function* () {
			const service = yield* OnboardingService;
			return yield* service.updateProfile({
				firstName: "Ada",
				lastName: "Lovelace",
				weekStartDay: "monday",
				timeFormat: "12h",
			});
		}).pipe(Effect.provide(layer)),
	);

	expect(insertedValues).toHaveBeenCalledWith(expect.objectContaining({ weekStartDay: "monday", timeFormat: "12h" }));
	expect(conflictUpdate).toHaveBeenCalledWith(
		expect.objectContaining({ set: expect.objectContaining({ weekStartDay: "monday", timeFormat: "12h" }) }),
	);
});

it("rejects invalid time format values before writing", async () => {
	const mockDb = { query: { employee: { findFirst: vi.fn(async () => null) } }, insert: vi.fn() };
	const authLayer = Layer.succeed(
		AuthService,
		AuthService.of({
			getSession: () => Effect.succeed({ user: { id: "user-1" }, session: { activeOrganizationId: null } } as never),
		}),
	);
	const dbLayer = Layer.succeed(
		DatabaseService,
		DatabaseService.of({ db: mockDb as never, query: (_name, query) => Effect.promise(query) as never }),
	);
	const layer = OnboardingServiceLive.pipe(Layer.provide(authLayer), Layer.provide(dbLayer));

	const result = await Effect.runPromise(
		Effect.either(
			Effect.gen(function* () {
				const service = yield* OnboardingService;
				return yield* service.updateProfile({
					firstName: "Ada",
					lastName: "Lovelace",
					weekStartDay: "sunday",
					timeFormat: "locale",
				} as never);
			}).pipe(Effect.provide(layer)),
		),
	);

	expect(result).toMatchObject({ _tag: "Left", left: expect.any(ValidationError) });
	expect(result).toMatchObject({ left: { message: "Time format must be 12h or 24h", field: "timeFormat" } });
	expect(mockDb.insert).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run onboarding tests to verify they fail**

Run: `pnpm --filter webapp test -- src/app/[locale]/onboarding/profile/page.test.tsx src/app/[locale]/onboarding/profile/actions.test.ts src/lib/effect/services/onboarding.service.test.ts`

Expected: FAIL because `timeFormat` is not in schema, UI, or service persistence.

- [ ] **Step 3: Add schema field**

Modify `apps/webapp/src/lib/validations/onboarding.ts`:

```ts
export const onboardingProfileSchema = z.object({
	firstName: z.string().min(1, "First name is required").max(50),
	lastName: z.string().min(1, "Last name is required").max(50),
	gender: z.enum(["male", "female", "other"]).optional(),
	birthday: z.date().optional(),
	weekStartDay: z.enum(["sunday", "monday"]).default("sunday"),
	timeFormat: z.enum(["24h", "12h"]).default("24h"),
});
```

- [ ] **Step 4: Add onboarding form field**

Modify imports in `apps/webapp/src/app/[locale]/onboarding/profile/page.tsx`:

```ts
import { TIME_FORMAT_OPTIONS, type TimeFormat } from "@/lib/user-preferences/time-format";
```

Add to `defaultValues`:

```ts
	timeFormat: "24h" as TimeFormat,
```

Insert after the week-start field:

```tsx
<form.Field name="timeFormat">
	{(field) => (
		<div className="space-y-2">
			<Label htmlFor="time-format">{t("onboarding.profile.timeFormat", "Time format")}</Label>
			<Select
				value={field.state.value}
				onValueChange={(value) => field.handleChange(value as TimeFormat)}
				disabled={loading}
			>
				<SelectTrigger id="time-format" className="w-full">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{TIME_FORMAT_OPTIONS.map((option) => (
						<SelectItem key={option.value} value={option.value}>
							{option.value === "24h"
								? t("onboarding.profile.timeFormat24h", "24-hour (08:00)")
								: t("onboarding.profile.timeFormat12h", "12-hour (8:00 AM)")}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<p className="text-sm text-muted-foreground">
				{t("onboarding.profile.timeFormatDesc", "This controls how clock times are displayed.")}
			</p>
		</div>
	)}
</form.Field>
```

- [ ] **Step 5: Add onboarding service validation and persistence**

Modify imports in `apps/webapp/src/lib/effect/services/onboarding.service.ts`:

```ts
import { isTimeFormat } from "@/lib/user-preferences/time-format";
```

In `updateProfile`, after week-start validation:

```ts
if (!isTimeFormat(data.timeFormat)) {
	return yield* Effect.fail(
		new ValidationError({
			message: "Time format must be 12h or 24h",
			field: "timeFormat",
		}),
	);
}
```

In `insert(userSettings).values` and `onConflictDoUpdate.set`, include:

```ts
timeFormat: data.timeFormat,
```

- [ ] **Step 6: Run onboarding tests to verify they pass**

Run: `pnpm --filter webapp test -- src/app/[locale]/onboarding/profile/page.test.tsx src/app/[locale]/onboarding/profile/actions.test.ts src/lib/effect/services/onboarding.service.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add apps/webapp/src/lib/validations/onboarding.ts apps/webapp/src/app/[locale]/onboarding/profile/page.tsx apps/webapp/src/app/[locale]/onboarding/profile/page.test.tsx apps/webapp/src/app/[locale]/onboarding/profile/actions.test.ts apps/webapp/src/lib/effect/services/onboarding.service.ts apps/webapp/src/lib/effect/services/onboarding.service.test.ts
git commit -m "feat: collect time format during onboarding"
```

## Task 4: Make TimeInput Picker-Driven And Preference-Aware

**Files:**
- Modify: `apps/webapp/src/components/ui/time-input.tsx`
- Modify: `apps/webapp/src/components/ui/time-input.test.tsx`

- [ ] **Step 1: Update failing `TimeInput` tests**

Modify `apps/webapp/src/components/ui/time-input.test.tsx` with these assertions:

```tsx
it("uses timepicker-ui without rendering a native time input", () => {
	render(<TimeInput aria-label="Start time" value="09:00" onChange={vi.fn()} />);

	const input = screen.getByLabelText("Start time");

	expect(input.getAttribute("type")).toBe("text");
	expect(input.hasAttribute("readonly")).toBe(true);
	expect(createMock).toHaveBeenCalledTimes(1);
	expect(instances[0]?.input).toBe(input);
	expect(instances[0]?.options.clock?.type).toBe("24h");
});

it("passes 12h preference to timepicker-ui", () => {
	render(<TimeInput aria-label="Start time" value="09:00" timeFormat="12h" onChange={vi.fn()} />);

	expect(instances[0]?.options.clock?.type).toBe("12h");
});

it("does not emit manual typing changes", () => {
	const handleChange = vi.fn();
	render(<TimeInput aria-label="Start time" value="" onChange={handleChange} />);

	fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "08:15" } });

	expect(handleChange).not.toHaveBeenCalled();
});
```

Also update the mocked `options` type near the top:

```ts
options: {
	clock?: { type?: "12h" | "24h" };
	callbacks?: {
		onConfirm?: (data: { hour?: string | null; minutes?: string | null }) => void;
	};
};
```

- [ ] **Step 2: Run `TimeInput` tests to verify they fail**

Run: `pnpm --filter webapp test -- src/components/ui/time-input.test.tsx`

Expected: FAIL because the component is not read-only, does not accept `timeFormat`, and still forwards manual changes.

- [ ] **Step 3: Update `TimeInput` implementation**

Modify `apps/webapp/src/components/ui/time-input.tsx`:

```tsx
"use client";

import type * as React from "react";
import { useEffect, useRef } from "react";
import { TimepickerUI } from "timepicker-ui";
import { cn } from "@/lib/utils";
import { normalizeTimeFormat, timeFormatToPickerType, type TimeFormat } from "@/lib/user-preferences/time-format";

type TimeInputProps = Omit<React.ComponentProps<"input">, "type" | "readOnly"> & {
	timeFormat?: TimeFormat | string | null;
};

function TimeInput({ className, onChange, value, defaultValue, timeFormat, ...props }: TimeInputProps) {
	const inputRef = useRef<HTMLInputElement>(null);
	const onChangeRef = useRef(onChange);
	const pickerFormat = normalizeTimeFormat(timeFormat);

	onChangeRef.current = onChange;

	useEffect(() => {
		if (!inputRef.current) {
			return;
		}

		const picker = new TimepickerUI(inputRef.current, {
			clock: {
				type: timeFormatToPickerType(pickerFormat),
			},
			ui: {
				editable: false,
			},
			callbacks: {
				onConfirm: (data) => {
					if (!inputRef.current || !data.hour || !data.minutes) {
						return;
					}

					inputRef.current.value = `${data.hour}:${data.minutes}`;
					onChangeRef.current?.({
						target: inputRef.current,
					} as React.ChangeEvent<HTMLInputElement>);
				},
			},
		});

		picker.create();

		return () => picker.destroy();
	}, [pickerFormat]);

	return (
		<input
			className={cn(
				"flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs outline-none transition-[color,box-shadow] selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:font-medium file:text-foreground file:text-sm placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
				"focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
				"aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
				className,
			)}
			data-slot="time-input"
			defaultValue={defaultValue}
			readOnly
			ref={inputRef}
			type="text"
			value={value}
			{...props}
		/>
	);
}

export { TimeInput };
```

- [ ] **Step 4: Run `TimeInput` tests to verify they pass**

Run: `pnpm --filter webapp test -- src/components/ui/time-input.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add apps/webapp/src/components/ui/time-input.tsx apps/webapp/src/components/ui/time-input.test.tsx
git commit -m "feat: make time inputs picker driven"
```

## Task 5: Apply Time Format To Representative Displays

**Files:**
- Modify: `apps/webapp/src/components/time-tracking/clock-in-out-widget-parts.tsx`
- Modify: `apps/webapp/src/components/time-tracking/time-clock-popover.tsx`
- Modify call sites if TypeScript reports new required props.

- [ ] **Step 1: Add display formatting API to components**

Modify `apps/webapp/src/components/time-tracking/clock-in-out-widget-parts.tsx` imports:

```ts
import { getTimeFormatDateTimeOptions, type TimeFormat } from "@/lib/user-preferences/time-format";
```

Remove the module-level `timeFormatter`. Update `ActiveSessionSummary`:

```tsx
export function ActiveSessionSummary({
	elapsedSeconds,
	startTime,
	t,
	timeFormat = "24h",
}: {
	elapsedSeconds: number;
	startTime: Date;
	t: TFnType;
	timeFormat?: TimeFormat;
}) {
	const timeFormatter = new Intl.DateTimeFormat(undefined, getTimeFormatDateTimeOptions(timeFormat));

	return (
		<div className="flex flex-col gap-2">
			<div className="font-bold text-3xl tabular-nums">{formatDurationWithSeconds(elapsedSeconds)}</div>
			<div className="text-muted-foreground text-sm">
				{t("timeTracking.startedAt", "Started at")} {timeFormatter.format(new Date(startTime))}
			</div>
		</div>
	);
}
```

Modify `apps/webapp/src/components/time-tracking/time-clock-popover.tsx` imports:

```ts
import { getTimeFormatDateTimeOptions, type TimeFormat } from "@/lib/user-preferences/time-format";
```

Remove the module-level formatter. Add prop support:

```tsx
export function TimeClockPopover({ timeFormat = "24h" }: { timeFormat?: TimeFormat }) {
	const { t } = useTranslate();
	const [open, setOpen] = useState(false);
	const timeFormatter = new Intl.DateTimeFormat(undefined, getTimeFormatDateTimeOptions(timeFormat));
```

Where `ActiveSessionSummary` is rendered in this component, pass `timeFormat={timeFormat}`.

- [ ] **Step 2: Run TypeScript-adjacent tests for helper and changed components**

Run: `pnpm --filter webapp test -- src/lib/user-preferences/time-format.test.ts src/components/ui/time-input.test.tsx`

Expected: PASS. This task relies on the final build/typecheck to catch display component type issues because these components currently lack focused tests.

- [ ] **Step 3: Commit Task 5**

```bash
git add apps/webapp/src/components/time-tracking/clock-in-out-widget-parts.tsx apps/webapp/src/components/time-tracking/time-clock-popover.tsx
git commit -m "feat: respect time format in clock displays"
```

## Task 6: Final Verification And Cleanup

**Files:**
- Review all modified files.
- No new files expected beyond prior tasks.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm --filter webapp test -- src/lib/user-preferences/time-format.test.ts src/components/ui/time-input.test.tsx src/components/settings/time-format-settings.test.tsx src/app/[locale]/onboarding/profile/page.test.tsx src/app/[locale]/onboarding/profile/actions.test.ts src/lib/effect/services/onboarding.service.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run broader webapp tests**

Run: `pnpm --filter webapp test`

Expected: PASS. If this fails because of unrelated pre-existing tests, capture the failing test names and rerun the focused suite from Step 1.

- [ ] **Step 3: Run build verification**

Run: `pnpm --filter webapp build`

Expected: PASS. If the build requires unavailable environment variables, stop and report the skipped build with the missing variables or command output.

- [ ] **Step 4: Inspect git diff**

Run: `git diff --stat && git diff -- apps/webapp/src/lib/user-preferences apps/webapp/src/components/ui/time-input.tsx apps/webapp/src/components/settings/time-format-settings.tsx apps/webapp/src/app/[locale]/onboarding/profile/page.tsx`

Expected: Diff only includes time format preference, picker behavior, onboarding/profile settings, and representative time display updates.

- [ ] **Step 5: Commit verification fixes if any were needed**

If Step 1, Step 2, or Step 3 required fixes, commit them:

```bash
git add apps/webapp/src
git commit -m "fix: stabilize time format preference"
```

If no fixes were needed, do not create an empty commit.

## Self-Review Notes

- Spec coverage: data model is Task 1; profile setting is Task 2; onboarding is Task 3; picker-only `TimeInput` is Task 4; display formatting is Task 5; verification is Task 6.
- Date fields remain untouched throughout the plan.
- Storage stays `HH:mm`; formatter changes only display output.
- Default is explicitly `24h` in schema and helper normalization.
- No locale-inference behavior is included.
