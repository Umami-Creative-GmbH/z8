# Time-Based Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a permission-gated `time` theme option that resolves to light during local daylight and dark outside daylight using browser geolocation and SunCalc.

**Architecture:** Keep `ThemeProvider` as the single owner of selected and resolved theme state. Add local-only coordinate persistence, geolocation handling, SunCalc-based resolution, and a next-boundary scheduler inside the provider. Extend existing theme menus to expose the new option and show a concise location-required error.

**Tech Stack:** React 19, Next.js client components, Vitest/jsdom, `suncalc`, localStorage, browser geolocation, Tabler icons, Tolgee translations.

---

## File Structure

- Modify `apps/webapp/src/components/theme-provider.tsx`: add `time` theme support, geolocation request flow, coordinate storage, SunCalc resolution, boundary scheduling, and theme error context.
- Modify `apps/webapp/src/components/theme-provider.test.tsx`: add provider-level tests for successful geolocation, denied geolocation, stored time mode, boundary scheduling, and invalid SunCalc fallback.
- Create `apps/webapp/src/types/suncalc.d.ts`: provide the minimal module type declaration needed because `@types/suncalc` is not installed.
- Modify `apps/webapp/src/components/nav-user.tsx`: add `Time based` option to mobile and desktop theme menus and render the provider error.
- Modify `apps/webapp/src/components/nav-user.test.tsx`: mock the local theme provider correctly and assert the new option appears in the mobile theme section.
- Modify `apps/webapp/src/components/theme-toggle.tsx`: add `Time based` to the compact theme dropdown.
- No database, migration, environment variable, or backend files should be changed.

## Task 1: Provider Tests And SunCalc Type Stub

**Files:**
- Create: `apps/webapp/src/types/suncalc.d.ts`
- Modify: `apps/webapp/src/components/theme-provider.test.tsx`

- [ ] **Step 1: Add the SunCalc declaration**

Create `apps/webapp/src/types/suncalc.d.ts`:

```ts
declare module "suncalc" {
	export type SunTimes = {
		dawn: Date;
		dusk: Date;
		goldenHour: Date;
		goldenHourEnd: Date;
		nadir: Date;
		nauticalDawn: Date;
		nauticalDusk: Date;
		night: Date;
		nightEnd: Date;
		solarNoon: Date;
		sunrise: Date;
		sunriseEnd: Date;
		sunset: Date;
		sunsetStart: Date;
	};

	export function getTimes(date: Date, latitude: number, longitude: number): SunTimes;
}
```

- [ ] **Step 2: Replace provider test setup with controllable SunCalc and geolocation mocks**

In `apps/webapp/src/components/theme-provider.test.tsx`, update the imports and add the mock helpers near the top:

```tsx
/* @vitest-environment jsdom */

import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider, useTheme } from "./theme-provider";

const mockSunCalc = vi.hoisted(() => ({
	getTimes: vi.fn(),
}));

vi.mock("suncalc", () => mockSunCalc);

const daylightTimes = {
	dawn: new Date("2026-05-27T04:30:00.000Z"),
	dusk: new Date("2026-05-27T20:30:00.000Z"),
	goldenHour: new Date("2026-05-27T19:00:00.000Z"),
	goldenHourEnd: new Date("2026-05-27T07:00:00.000Z"),
	nadir: new Date("2026-05-27T00:00:00.000Z"),
	nauticalDawn: new Date("2026-05-27T04:00:00.000Z"),
	nauticalDusk: new Date("2026-05-27T21:00:00.000Z"),
	night: new Date("2026-05-27T22:00:00.000Z"),
	nightEnd: new Date("2026-05-27T03:00:00.000Z"),
	solarNoon: new Date("2026-05-27T12:00:00.000Z"),
	sunrise: new Date("2026-05-27T06:00:00.000Z"),
	sunriseEnd: new Date("2026-05-27T06:05:00.000Z"),
	sunset: new Date("2026-05-27T18:00:00.000Z"),
	sunsetStart: new Date("2026-05-27T17:55:00.000Z"),
};

function mockGeolocationSuccess(latitude = 52.52, longitude = 13.405) {
	const getCurrentPosition = vi.fn((success: PositionCallback) => {
		success({
			coords: { latitude, longitude },
		} as GeolocationPosition);
	});
	Object.defineProperty(navigator, "geolocation", {
		configurable: true,
		value: { getCurrentPosition },
	});
	return getCurrentPosition;
}

function mockGeolocationError() {
	const getCurrentPosition = vi.fn((_success: PositionCallback, error?: PositionErrorCallback) => {
		error?.({ code: 1, message: "denied", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
	});
	Object.defineProperty(navigator, "geolocation", {
		configurable: true,
		value: { getCurrentPosition },
	});
	return getCurrentPosition;
}
```

- [ ] **Step 3: Extend the test consumer with time-mode controls and error output**

Replace the existing `Consumer` in `theme-provider.test.tsx` with:

```tsx
function Consumer() {
	const { resolvedTheme, setTheme, theme, themeError } = useTheme();

	return (
		<div>
			<p>Theme: {theme}</p>
			<p>Resolved: {resolvedTheme}</p>
			<p>Error: {themeError ?? "none"}</p>
			<button type="button" onClick={() => setTheme("dark")}>
				Set Dark
			</button>
			<button type="button" onClick={() => setTheme("time")}>
				Set Time
			</button>
		</div>
	);
}
```

- [ ] **Step 4: Reset mocks and time before each provider test**

Replace the existing `beforeEach` body with:

```tsx
beforeEach(() => {
	vi.useRealTimers();
	vi.setSystemTime(new Date("2026-05-27T12:00:00.000Z"));
	localStorage.clear();
	document.documentElement.className = "";
	document.documentElement.style.colorScheme = "";
	mockSunCalc.getTimes.mockReturnValue(daylightTimes);
	Object.defineProperty(window, "matchMedia", {
		configurable: true,
		value: vi.fn(() => ({
			matches: false,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		})),
	});
	Object.defineProperty(navigator, "geolocation", {
		configurable: true,
		value: undefined,
	});
});
```

- [ ] **Step 5: Add the successful time-mode test**

Add this test inside `describe("ThemeProvider", () => { ... })`:

```tsx
it("enables time theme after geolocation succeeds", async () => {
	mockGeolocationSuccess(52.52, 13.405);

	render(
		<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
			<Consumer />
		</ThemeProvider>,
	);

	act(() => {
		screen.getByRole("button", { name: "Set Time" }).click();
	});

	await waitFor(() => expect(screen.getByText("Theme: time")).toBeTruthy());
	expect(screen.getByText("Resolved: light")).toBeTruthy();
	expect(screen.getByText("Error: none")).toBeTruthy();
	expect(localStorage.getItem("theme")).toBe("time");
	expect(localStorage.getItem("theme-location")).toBe(JSON.stringify({ latitude: 52.52, longitude: 13.405 }));
	expect(document.documentElement.classList.contains("light")).toBe(true);
});
```

- [ ] **Step 6: Add the denied-location preservation test**

Add this test:

```tsx
it("keeps the previous theme when geolocation fails", async () => {
	localStorage.setItem("theme", "dark");
	mockGeolocationError();

	render(
		<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
			<Consumer />
		</ThemeProvider>,
	);

	act(() => {
		screen.getByRole("button", { name: "Set Time" }).click();
	});

	await waitFor(() => expect(screen.getByText("Error: location-required")).toBeTruthy());
	expect(screen.getByText("Theme: dark")).toBeTruthy();
	expect(screen.getByText("Resolved: dark")).toBeTruthy();
	expect(localStorage.getItem("theme")).toBe("dark");
	expect(localStorage.getItem("theme-location")).toBeNull();
});
```

- [ ] **Step 7: Add stored time-mode and scheduler tests**

Add these tests:

```tsx
it("loads stored time theme with stored coordinates without requesting location", async () => {
	localStorage.setItem("theme", "time");
	localStorage.setItem("theme-location", JSON.stringify({ latitude: 48.8566, longitude: 2.3522 }));
	const getCurrentPosition = mockGeolocationSuccess();

	render(
		<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
			<Consumer />
		</ThemeProvider>,
	);

	expect(await screen.findByText("Theme: time")).toBeTruthy();
	expect(screen.getByText("Resolved: light")).toBeTruthy();
	expect(getCurrentPosition).not.toHaveBeenCalled();
	expect(mockSunCalc.getTimes).toHaveBeenCalledWith(expect.any(Date), 48.8566, 2.3522);
});

it("recalculates time theme at the next sun boundary", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-05-27T17:59:59.000Z"));
	localStorage.setItem("theme", "time");
	localStorage.setItem("theme-location", JSON.stringify({ latitude: 52.52, longitude: 13.405 }));
	mockSunCalc.getTimes.mockReturnValue(daylightTimes);

	render(
		<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
			<Consumer />
		</ThemeProvider>,
	);

	expect(await screen.findByText("Resolved: light")).toBeTruthy();

	act(() => {
		vi.setSystemTime(new Date("2026-05-27T18:00:01.000Z"));
		vi.advanceTimersByTime(2000);
	});

	await waitFor(() => expect(screen.getByText("Resolved: dark")).toBeTruthy());
	expect(document.documentElement.classList.contains("dark")).toBe(true);
});
```

- [ ] **Step 8: Add invalid SunCalc fallback test**

Add this test:

```tsx
it("falls back to system theme when time calculations are invalid", async () => {
	localStorage.setItem("theme", "time");
	localStorage.setItem("theme-location", JSON.stringify({ latitude: 78.2232, longitude: 15.6267 }));
	mockSunCalc.getTimes.mockReturnValue({
		...daylightTimes,
		sunrise: new Date(Number.NaN),
		sunset: new Date(Number.NaN),
	});
	Object.defineProperty(window, "matchMedia", {
		configurable: true,
		value: vi.fn(() => ({
			matches: true,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		})),
	});

	render(
		<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
			<Consumer />
		</ThemeProvider>,
	);

	expect(await screen.findByText("Theme: time")).toBeTruthy();
	expect(screen.getByText("Resolved: dark")).toBeTruthy();
});
```

- [ ] **Step 9: Run provider tests and verify they fail before implementation**

Run:

```bash
pnpm --dir apps/webapp test src/components/theme-provider.test.tsx
```

Expected: FAIL because `themeError`, `time` resolution, `theme-location`, and SunCalc/geolocation support are not implemented yet.

## Task 2: ThemeProvider Time Mode Implementation

**Files:**
- Modify: `apps/webapp/src/components/theme-provider.tsx`

- [ ] **Step 1: Update imports, theme types, context shape, and constants**

In `theme-provider.tsx`, replace the React import and top-level types/constants with:

```tsx
import { getTimes } from "suncalc";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type Theme = "light" | "dark" | "system" | "time";
type ResolvedTheme = "light" | "dark";
type ThemeLocation = { latitude: number; longitude: number };
type ThemeError = "location-required";

type ThemeProviderProps = {
	children: React.ReactNode;
	attribute?: "class" | `data-${string}` | Array<"class" | `data-${string}`>;
	defaultTheme?: Theme;
	disableTransitionOnChange?: boolean;
	enableColorScheme?: boolean;
	enableSystem?: boolean;
	storageKey?: string;
	themes?: string[];
	value?: Record<string, string>;
};

type ThemeContextValue = {
	clearThemeError: () => void;
	forcedTheme?: string;
	resolvedTheme?: ResolvedTheme;
	setTheme: React.Dispatch<React.SetStateAction<string>>;
	systemTheme?: ResolvedTheme;
	theme?: string;
	themeError?: ThemeError;
	themes: string[];
};

const DEFAULT_THEMES = ["light", "dark"];
const TIME_THEME = "time";
const GEOLOCATION_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 2_147_483_647;
const ThemeContext = createContext<ThemeContextValue>({
	clearThemeError: () => {},
	setTheme: () => {},
	themes: [],
});
```

- [ ] **Step 2: Add location storage and time resolution helpers**

Add these helpers after `getLocalStorage()`:

```tsx
function getLocationStorageKey(storageKey: string) {
	return `${storageKey}-location`;
}

function isValidCoordinate(value: unknown, min: number, max: number): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function isValidThemeLocation(value: unknown): value is ThemeLocation {
	if (!value || typeof value !== "object") {
		return false;
	}

	const location = value as Partial<ThemeLocation>;
	return isValidCoordinate(location.latitude, -90, 90) && isValidCoordinate(location.longitude, -180, 180);
}

function readStoredLocation(storageKey: string): ThemeLocation | undefined {
	try {
		const value = getLocalStorage()?.getItem(getLocationStorageKey(storageKey));
		if (!value) {
			return undefined;
		}
		const parsed = JSON.parse(value) as unknown;
		return isValidThemeLocation(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function writeStoredLocation(storageKey: string, location: ThemeLocation) {
	try {
		getLocalStorage()?.setItem(getLocationStorageKey(storageKey), JSON.stringify(location));
	} catch {
		// Keep the current session updated even when persistence is blocked.
	}
}

function isValidDate(value: Date) {
	return Number.isFinite(value.getTime());
}

function resolveTimeTheme(location: ThemeLocation, systemTheme: ResolvedTheme, now = new Date()): ResolvedTheme {
	const times = getTimes(now, location.latitude, location.longitude);
	if (!isValidDate(times.sunrise) || !isValidDate(times.sunset)) {
		return systemTheme;
	}

	return now >= times.sunrise && now < times.sunset ? "light" : "dark";
}

function getNextSunBoundary(location: ThemeLocation, now = new Date()) {
	const today = getTimes(now, location.latitude, location.longitude);
	if (isValidDate(today.sunrise) && now < today.sunrise) {
		return today.sunrise;
	}
	if (isValidDate(today.sunset) && now < today.sunset) {
		return today.sunset;
	}

	const tomorrow = new Date(now);
	tomorrow.setDate(tomorrow.getDate() + 1);
	const tomorrowTimes = getTimes(tomorrow, location.latitude, location.longitude);
	return isValidDate(tomorrowTimes.sunrise) ? tomorrowTimes.sunrise : undefined;
}
```

- [ ] **Step 3: Replace `resolveTheme` with time-aware resolution**

Replace the existing `resolveTheme` function with:

```tsx
function resolveTheme({
	enableSystem,
	location,
	systemTheme,
	theme,
}: {
	enableSystem: boolean;
	location?: ThemeLocation;
	systemTheme: ResolvedTheme;
	theme: string | undefined;
}): ResolvedTheme {
	if (theme === TIME_THEME) {
		return location ? resolveTimeTheme(location, systemTheme) : systemTheme;
	}

	return enableSystem && theme === "system" ? systemTheme : theme === "dark" ? "dark" : "light";
}
```

- [ ] **Step 4: Add geolocation request helper inside `ThemeProvider`**

Inside `ThemeProvider`, after the existing `systemTheme` state is declared, add location and error state:

```tsx
const [location, setLocation] = useState<ThemeLocation | undefined>(() => readStoredLocation(storageKey));
const [themeError, setThemeError] = useState<ThemeError | undefined>();
const [timeThemeTick, setTimeThemeTick] = useState(0);
```

Then replace the existing `resolvedTheme` line with:

```tsx
const resolvedTheme = resolveTheme({ enableSystem, location, systemTheme, theme });
void timeThemeTick;
```

Add this callback before `setTheme`:

```tsx
const requestThemeLocation = useCallback(
	(onSuccess: (location: ThemeLocation) => void, onError: () => void) => {
		if (typeof navigator === "undefined" || !navigator.geolocation) {
			onError();
			return;
		}

		navigator.geolocation.getCurrentPosition(
			(position) => {
				const nextLocation = {
					latitude: position.coords.latitude,
					longitude: position.coords.longitude,
				};
				if (!isValidThemeLocation(nextLocation)) {
					onError();
					return;
				}
				onSuccess(nextLocation);
			},
			() => onError(),
			{ enableHighAccuracy: false, maximumAge: 86_400_000, timeout: GEOLOCATION_TIMEOUT_MS },
		);
	},
	[],
);
```

- [ ] **Step 5: Replace `setTheme` with the permission-gated version**

Replace the existing `setTheme` callback with:

```tsx
const setTheme = useCallback<React.Dispatch<React.SetStateAction<string>>>(
	(nextTheme) => {
		setThemeState((currentTheme) => {
			const nextValue = typeof nextTheme === "function" ? nextTheme(currentTheme) : nextTheme;

			if (nextValue === TIME_THEME) {
				requestThemeLocation(
					(nextLocation) => {
						if (disableTransitionOnChange) {
							disableTransitionsTemporarily();
						}
						setThemeError(undefined);
						setLocation(nextLocation);
						writeStoredLocation(storageKey, nextLocation);
						writeStoredTheme(storageKey, TIME_THEME);
						setThemeState(TIME_THEME);
					},
					() => setThemeError("location-required"),
				);
				return currentTheme;
			}

			if (disableTransitionOnChange) {
				disableTransitionsTemporarily();
			}
			setThemeError(undefined);
			writeStoredTheme(storageKey, nextValue);
			return nextValue;
		});
	},
	[disableTransitionOnChange, requestThemeLocation, storageKey],
);
```

- [ ] **Step 6: Add next-boundary scheduling effect**

Add this effect after the existing apply-theme effect:

```tsx
useEffect(() => {
	if (theme !== TIME_THEME || !location) {
		return;
	}

	const nextBoundary = getNextSunBoundary(location);
	if (!nextBoundary) {
		return;
	}

	const delay = Math.max(0, Math.min(nextBoundary.getTime() - Date.now() + 1000, MAX_TIMEOUT_MS));
	const timeout = window.setTimeout(() => {
		setTimeThemeTick((tick) => tick + 1);
	}, delay);

	return () => window.clearTimeout(timeout);
}, [location, theme, timeThemeTick]);
```

- [ ] **Step 7: Expose error helpers and include `time` in context themes**

Add this callback before the `context` memo:

```tsx
const clearThemeError = useCallback(() => setThemeError(undefined), []);
```

Replace the `context` memo with:

```tsx
const context = useMemo<ThemeContextValue>(
	() => ({
		clearThemeError,
		resolvedTheme,
		setTheme,
		systemTheme,
		theme,
		themeError,
		themes: enableSystem ? [...themes, TIME_THEME, "system"] : [...themes, TIME_THEME],
	}),
	[clearThemeError, enableSystem, resolvedTheme, setTheme, systemTheme, theme, themeError, themes],
);
```

- [ ] **Step 8: Run provider tests and verify they pass**

Run:

```bash
pnpm --dir apps/webapp test src/components/theme-provider.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit provider changes only if commits are explicitly requested for this session**

If the user has explicitly requested commits, run:

```bash
git add apps/webapp/src/components/theme-provider.tsx apps/webapp/src/components/theme-provider.test.tsx apps/webapp/src/types/suncalc.d.ts
git commit -m "feat: add time-based theme resolution"
```

Expected: commit succeeds. If commits were not explicitly requested, skip this step and leave the files unstaged.

## Task 3: Theme Menu UI Updates

**Files:**
- Modify: `apps/webapp/src/components/nav-user.tsx`
- Modify: `apps/webapp/src/components/nav-user.test.tsx`
- Modify: `apps/webapp/src/components/theme-toggle.tsx`

- [ ] **Step 1: Update `NavUser` icon imports and theme context usage**

In `nav-user.tsx`, add `IconClock` to the Tabler import list:

```tsx
import {
	IconChevronDown,
	IconClock,
	IconDeviceDesktop,
	IconDotsVertical,
	IconLanguage,
	IconLoader2,
	IconLogout,
	IconMoon,
	IconPalette,
	IconShield,
	IconSun,
	IconTextSize,
	IconUserCircle,
} from "@tabler/icons-react";
```

Replace:

```tsx
const { theme, setTheme } = useTheme();
```

with:

```tsx
const { clearThemeError, setTheme, theme, themeError } = useTheme();
```

Add this handler after `handleFontSizeChange`:

```tsx
const handleThemeChange = (value: string) => {
	clearThemeError();
	setTheme(value);
};
```

- [ ] **Step 2: Add mobile time option and error message**

In the mobile theme `DropdownMenuRadioGroup`, replace `onValueChange={setTheme}` with `onValueChange={handleThemeChange}` and insert this option between `dark` and `system`:

```tsx
<DropdownMenuRadioItem className={mobileRadioItemClassName} value="time">
	<IconClock className="mr-2 size-4" />
	{t("user.theme-time", "Time based")}
</DropdownMenuRadioItem>
```

Immediately after the closing `</DropdownMenuRadioGroup>`, add:

```tsx
{themeError === "location-required" && (
	<p className="px-2 py-1 text-muted-foreground text-xs" role="alert">
		{t("user.theme-location-required", "Location permission is required for time-based theme.")}
	</p>
)}
```

- [ ] **Step 3: Add desktop time option and error message**

In the desktop theme `DropdownMenuRadioGroup`, replace `onValueChange={setTheme}` with `onValueChange={handleThemeChange}` and insert this option between `dark` and `system`:

```tsx
<DropdownMenuRadioItem value="time">
	<IconClock className="mr-2 size-4" />
	{t("user.theme-time", "Time based")}
</DropdownMenuRadioItem>
```

Immediately after the closing `</DropdownMenuRadioGroup>`, add:

```tsx
{themeError === "location-required" && (
	<p className="max-w-52 px-2 py-1 text-muted-foreground text-xs" role="alert">
		{t("user.theme-location-required", "Location permission is required for time-based theme.")}
	</p>
)}
```

- [ ] **Step 4: Fix `NavUser` test theme-provider mock and add error state**

In `nav-user.test.tsx`, replace the `next-themes` mock with a mock for the local provider:

```tsx
const mockThemeState = vi.hoisted(() => ({
	clearThemeError: vi.fn(),
	setTheme: vi.fn(),
	theme: "system",
	themeError: undefined as "location-required" | undefined,
}));

vi.mock("@/components/theme-provider", () => ({
	useTheme: () => mockThemeState,
}));
```

Remove this obsolete block:

```tsx
vi.mock("next-themes", () => ({
	useTheme: () => ({ theme: "system", setTheme: vi.fn() }),
}));
```

- [ ] **Step 5: Reset theme mocks before each `NavUser` test**

Inside `describe("NavUser", () => {`, add:

```tsx
beforeEach(() => {
	mockThemeState.clearThemeError.mockClear();
	mockThemeState.setTheme.mockClear();
	mockThemeState.theme = "system";
	mockThemeState.themeError = undefined;
});
```

Update the Vitest import at the top from:

```tsx
import { describe, expect, it, vi } from "vitest";
```

to:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
```

- [ ] **Step 6: Update the mobile theme-section test for the new option**

In the `collapses mobile language, font size, and theme options until their sections are opened` test, after the existing `expect(screen.getByText("Light")).toBeTruthy();`, add:

```tsx
expect(screen.getByText("Time based")).toBeTruthy();
```

- [ ] **Step 7: Add a NavUser error rendering test**

Add this test at the end of `describe("NavUser", () => { ... })`:

```tsx
it("shows the location-required message for time-based theme errors", () => {
	mockThemeState.themeError = "location-required";

	render(<NavUser user={{ id: "user-1", name: "Kai", email: "kai@example.com" }} />);

	fireEvent.click(screen.getByRole("button", { name: /theme/i }));

	expect(screen.getByRole("alert")).toHaveTextContent(
		"Location permission is required for time-based theme.",
	);
});
```

- [ ] **Step 8: Update the compact `ThemeToggle` dropdown**

In `theme-toggle.tsx`, add `IconClock` to the import:

```tsx
import { IconClock, IconMoon, IconSun } from "@tabler/icons-react";
```

Insert this item between the dark item and the closing `</DropdownMenuContent>`:

```tsx
<DropdownMenuItem onClick={() => setTheme("time")}>
	<IconClock className="mr-2 size-4" />
	{t("common:user.theme-time", "Time based")}
</DropdownMenuItem>
```

- [ ] **Step 9: Run UI tests**

Run:

```bash
pnpm --dir apps/webapp test src/components/nav-user.test.tsx src/components/theme-provider.test.tsx
```

Expected: PASS.

- [ ] **Step 10: Commit UI changes only if commits are explicitly requested for this session**

If the user has explicitly requested commits, run:

```bash
git add apps/webapp/src/components/nav-user.tsx apps/webapp/src/components/nav-user.test.tsx apps/webapp/src/components/theme-toggle.tsx
git commit -m "feat: expose time-based theme option"
```

Expected: commit succeeds. If commits were not explicitly requested, skip this step and leave the files unstaged.

## Task 4: Full Verification

**Files:**
- Verify all modified files.

- [ ] **Step 1: Run focused theme tests**

Run:

```bash
pnpm --dir apps/webapp test src/components/theme-provider.test.tsx src/components/nav-user.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run the webapp test suite**

Run:

```bash
pnpm --dir apps/webapp test
```

Expected: PASS. If unrelated existing tests fail, capture the failing test names and errors without changing unrelated code.

- [ ] **Step 3: Run the production build**

Run:

```bash
CI=true pnpm build
```

Expected: PASS. This must be run from the repository root because the repo-level command builds the full project.

- [ ] **Step 4: Inspect the final diff**

Run:

```bash
git diff -- apps/webapp/src/components/theme-provider.tsx apps/webapp/src/components/theme-provider.test.tsx apps/webapp/src/types/suncalc.d.ts apps/webapp/src/components/nav-user.tsx apps/webapp/src/components/nav-user.test.tsx apps/webapp/src/components/theme-toggle.tsx docs/superpowers/specs/2026-05-27-time-based-theme-design.md docs/superpowers/plans/2026-05-27-time-based-theme.md
```

Expected: diff only contains the time-based theme feature, its tests, and the planning/spec files.

- [ ] **Step 5: Final commit only if explicitly requested**

If commits are requested and earlier task commits were skipped, run:

```bash
git add apps/webapp/src/components/theme-provider.tsx apps/webapp/src/components/theme-provider.test.tsx apps/webapp/src/types/suncalc.d.ts apps/webapp/src/components/nav-user.tsx apps/webapp/src/components/nav-user.test.tsx apps/webapp/src/components/theme-toggle.tsx docs/superpowers/specs/2026-05-27-time-based-theme-design.md docs/superpowers/plans/2026-05-27-time-based-theme.md
git commit -m "feat: add time-based theme option"
```

Expected: commit succeeds. If commits were not explicitly requested, do not commit.

## Self-Review

- Spec coverage: The plan covers the `time` theme option, permission gating, local coordinate storage, denied-permission preservation, SunCalc resolution, automatic next-boundary updates, UI options, location-required messaging, and provider/UI tests.
- Placeholder scan: No `TBD`, `TODO`, or unspecified implementation steps remain. Code snippets name concrete files, functions, commands, and expected outcomes.
- Type consistency: The plan consistently uses `ThemeLocation`, `ThemeError`, `themeError`, `clearThemeError`, `TIME_THEME`, `theme-location`, and `location-required` across provider, UI, and tests.
