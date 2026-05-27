/* @vitest-environment jsdom */

import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
		queueMicrotask(() => {
			success({
				coords: {
					accuracy: 10,
					altitude: null,
					altitudeAccuracy: null,
					heading: null,
					latitude,
					longitude,
					speed: null,
				},
				timestamp: Date.now(),
			} as GeolocationPosition);
		});
	});
	Object.defineProperty(navigator, "geolocation", {
		configurable: true,
		value: { getCurrentPosition },
	});
	return getCurrentPosition;
}

function mockGeolocationDeferred(latitude = 52.52, longitude = 13.405) {
	let resolvePosition: () => void = () => {};
	const getCurrentPosition = vi.fn((success: PositionCallback) => {
		resolvePosition = () => {
			success({
				coords: {
					accuracy: 10,
					altitude: null,
					altitudeAccuracy: null,
					heading: null,
					latitude,
					longitude,
					speed: null,
				},
				timestamp: Date.now(),
			} as GeolocationPosition);
		};
	});
	Object.defineProperty(navigator, "geolocation", {
		configurable: true,
		value: { getCurrentPosition },
	});
	return { getCurrentPosition, resolvePosition: () => resolvePosition() };
}

function mockGeolocationError() {
	const getCurrentPosition = vi.fn((_success: PositionCallback, error?: PositionErrorCallback) => {
		queueMicrotask(() => {
			error?.({ code: 1, message: "denied", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
		});
	});
	Object.defineProperty(navigator, "geolocation", {
		configurable: true,
		value: { getCurrentPosition },
	});
	return getCurrentPosition;
}

function useControlledTime(value = "2026-05-27T12:00:00.000Z", fakeTimers = false) {
	vi.useFakeTimers(fakeTimers ? undefined : { toFake: ["Date"] });
	vi.setSystemTime(new Date(value));
}

function setupMockStorage() {
	const store = new Map<string, string>();
	const mockStorage: Storage = {
		clear: () => {
			store.clear();
		},
		getItem: (key: string) => store.get(key) ?? null,
		key: (index: number) => Array.from(store.keys())[index] ?? null,
		get length() {
			return store.size;
		},
		removeItem: (key: string) => {
			store.delete(key);
		},
		setItem: (key: string, value: string) => {
			store.set(key, String(value));
		},
	};

	Object.defineProperty(window, "localStorage", {
		configurable: true,
		value: mockStorage,
	});

	return mockStorage;
}

function Consumer() {
	const { resolvedTheme, setTheme, theme, themeError, timeThemeInfo } = useTheme();

	return (
		<div>
			<p>Theme: {theme}</p>
			<p>Resolved: {resolvedTheme}</p>
			<p>Error: {themeError ?? "none"}</p>
			<p>Time current: {timeThemeInfo?.currentTheme ?? "none"}</p>
			<p>Time next: {timeThemeInfo?.nextTheme ?? "none"}</p>
			<p>Time switch: {timeThemeInfo?.nextSwitchAt.toISOString() ?? "none"}</p>
			<button type="button" onClick={() => setTheme("dark")}>
				Set Dark
			</button>
			<button type="button" onClick={() => setTheme("time")}>
				Set Time
			</button>
		</div>
	);
}

beforeEach(() => {
	vi.useRealTimers();
	const storage = setupMockStorage();
	storage.clear();
	document.documentElement.className = "";
	document.documentElement.style.colorScheme = "";
	mockSunCalc.getTimes.mockClear();
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

afterEach(() => {
	vi.useRealTimers();
});

describe("ThemeProvider", () => {
	it("does not render script tags during client navigation", () => {
		const { container } = render(
			<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
				<Consumer />
			</ThemeProvider>,
		);

		expect(container.querySelector("script")).toBeNull();
	});

	it("loads the stored theme and updates html when changed", async () => {
		window.localStorage.setItem("theme", "light");

		render(
			<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
				<Consumer />
			</ThemeProvider>,
		);

		expect(await screen.findByText("Theme: light")).toBeTruthy();
		expect(screen.getByText("Resolved: light")).toBeTruthy();
		expect(document.documentElement.classList.contains("light")).toBe(true);

		act(() => {
			screen.getByRole("button", { name: "Set Dark" }).click();
		});

		expect(screen.getByText("Theme: dark")).toBeTruthy();
		expect(screen.getByText("Resolved: dark")).toBeTruthy();
		expect(window.localStorage.getItem("theme")).toBe("dark");
		expect(document.documentElement.classList.contains("dark")).toBe(true);
		expect(document.documentElement.classList.contains("light")).toBe(false);
	});

	it("enables time theme after geolocation succeeds", async () => {
		useControlledTime();
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
		expect(window.localStorage.getItem("theme")).toBe("time");
		expect(window.localStorage.getItem("theme-location")).toBe(
			JSON.stringify({ latitude: 52.52, longitude: 13.405 }),
		);
		expect(document.documentElement.classList.contains("light")).toBe(true);
	});

	it("exposes the next time-based theme switch when location is available", async () => {
		useControlledTime("2026-05-27T12:00:00.000Z");
		window.localStorage.setItem("theme", "time");
		window.localStorage.setItem("theme-location", JSON.stringify({ latitude: 52.52, longitude: 13.405 }));

		render(
			<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
				<Consumer />
			</ThemeProvider>,
		);

		expect(await screen.findByText("Time current: light")).toBeTruthy();
		expect(screen.getByText("Time next: dark")).toBeTruthy();
		expect(screen.getByText("Time switch: 2026-05-27T18:00:00.000Z")).toBeTruthy();
	});

	it("ignores a stale time geolocation success after selecting another theme", async () => {
		useControlledTime();
		const { resolvePosition } = mockGeolocationDeferred(52.52, 13.405);

		render(
			<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
				<Consumer />
			</ThemeProvider>,
		);

		act(() => {
			screen.getByRole("button", { name: "Set Time" }).click();
		});
		act(() => {
			screen.getByRole("button", { name: "Set Dark" }).click();
		});
		await act(async () => {
			resolvePosition();
			await Promise.resolve();
		});

		await waitFor(() => expect(screen.getByText("Theme: dark")).toBeTruthy());
		expect(screen.getByText("Resolved: dark")).toBeTruthy();
		expect(window.localStorage.getItem("theme")).toBe("dark");
		expect(window.localStorage.getItem("theme-location")).toBeNull();
	});

	it("keeps the previous theme when geolocation fails", async () => {
		window.localStorage.setItem("theme", "dark");
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
		expect(window.localStorage.getItem("theme")).toBe("dark");
		expect(window.localStorage.getItem("theme-location")).toBeNull();
	});

	it("loads stored time theme with stored coordinates without requesting location", async () => {
		useControlledTime();
		window.localStorage.setItem("theme", "time");
		window.localStorage.setItem("theme-location", JSON.stringify({ latitude: 48.8566, longitude: 2.3522 }));
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
		useControlledTime("2026-05-27T17:59:59.000Z", true);
		window.localStorage.setItem("theme", "time");
		window.localStorage.setItem("theme-location", JSON.stringify({ latitude: 52.52, longitude: 13.405 }));
		mockSunCalc.getTimes.mockReturnValue(daylightTimes);

		render(
			<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
				<Consumer />
			</ThemeProvider>,
		);

		expect(screen.getByText("Resolved: light")).toBeTruthy();

		act(() => {
			vi.setSystemTime(new Date("2026-05-27T18:00:01.000Z"));
			vi.advanceTimersByTime(2000);
		});

		expect(screen.getByText("Resolved: dark")).toBeTruthy();
		expect(document.documentElement.classList.contains("dark")).toBe(true);
	});

	it("falls back to system theme when sunrise and sunset calculations are invalid", async () => {
		useControlledTime();
		window.localStorage.setItem("theme", "time");
		window.localStorage.setItem("theme-location", JSON.stringify({ latitude: 78.2232, longitude: 15.6267 }));
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
});
