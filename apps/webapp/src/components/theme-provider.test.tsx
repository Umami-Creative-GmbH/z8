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
			error?.({
				code: 1,
				message: "denied",
				PERMISSION_DENIED: 1,
				POSITION_UNAVAILABLE: 2,
				TIMEOUT: 3,
			});
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
		window.localStorage.setItem(
			"theme-location",
			JSON.stringify({ latitude: 52.52, longitude: 13.405 }),
		);

		render(
			<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
				<Consumer />
			</ThemeProvider>,
		);

		expect(await screen.findByText("Time current: light")).toBeTruthy();
		expect(screen.getByText("Time next: dark")).toBeTruthy();
		expect(screen.getByText("Time switch: 2026-05-27T18:00:00.000Z")).toBeTruthy();
	});

	it("uses the observer's solar day across a UTC date boundary", async () => {
		useControlledTime("2026-05-27T20:00:00.000Z");
		window.localStorage.setItem("theme", "time");
		window.localStorage.setItem(
			"theme-location",
			JSON.stringify({ latitude: 35.6762, longitude: 139.6503 }),
		);
		mockSunCalc.getTimes.mockImplementation((date: Date) => {
			const isoDay = date.toISOString().slice(0, 10);
			const isCurrentSolarDay = date.getUTCDate() === 28;
			return {
				...daylightTimes,
				solarNoon: new Date(`${isoDay}T02:38:30.000Z`),
				sunrise: new Date(
					isCurrentSolarDay ? "2026-05-27T19:28:39.819Z" : "2026-05-26T19:29:07.716Z",
				),
				sunset: new Date(
					isCurrentSolarDay ? "2026-05-28T09:49:00.143Z" : "2026-05-27T09:48:18.581Z",
				),
			};
		});

		render(
			<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
				<Consumer />
			</ThemeProvider>,
		);

		expect(await screen.findByText("Resolved: light")).toBeTruthy();
		expect(screen.getByText("Time next: dark")).toBeTruthy();
		expect(screen.getByText("Time switch: 2026-05-28T09:49:00.143Z")).toBeTruthy();
	});

	it("uses the surrounding boundaries near the western antimeridian", async () => {
		useControlledTime("2026-03-20T00:00:00.000Z");
		window.localStorage.setItem("theme", "time");
		window.localStorage.setItem(
			"theme-location",
			JSON.stringify({ latitude: 0, longitude: -179.68 }),
		);
		mockSunCalc.getTimes.mockImplementation((date: Date) => {
			const isoDay = date.toISOString().slice(0, 10);
			const isCurrentSolarDay = date.getUTCDate() === 20;
			return {
				...daylightTimes,
				solarNoon: new Date(`${isoDay}T00:06:00.000Z`),
				sunrise: new Date(
					isCurrentSolarDay ? "2026-03-19T18:03:04.525Z" : "2026-03-18T18:03:22.068Z",
				),
				sunset: new Date(
					isCurrentSolarDay ? "2026-03-20T06:09:35.456Z" : "2026-03-19T06:09:53.093Z",
				),
			};
		});

		render(
			<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
				<Consumer />
			</ThemeProvider>,
		);

		expect(await screen.findByText("Resolved: light")).toBeTruthy();
		expect(screen.getByText("Time next: dark")).toBeTruthy();
		expect(screen.getByText("Time switch: 2026-03-20T06:09:35.456Z")).toBeTruthy();
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
		window.localStorage.setItem(
			"theme-location",
			JSON.stringify({ latitude: 48.8566, longitude: 2.3522 }),
		);
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
		window.localStorage.setItem(
			"theme-location",
			JSON.stringify({ latitude: 52.52, longitude: 13.405 }),
		);
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

	it("falls back to system theme when sunrise and sunset do not occur", async () => {
		useControlledTime();
		window.localStorage.setItem("theme", "time");
		window.localStorage.setItem(
			"theme-location",
			JSON.stringify({ latitude: 78.2232, longitude: 15.6267 }),
		);
		mockSunCalc.getTimes.mockReturnValue({
			...daylightTimes,
			sunrise: null,
			sunset: null,
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

	it("falls back on the first polar day when the adjacent day had events", async () => {
		useControlledTime("2026-04-19T12:00:00.000Z");
		window.localStorage.setItem("theme", "time");
		window.localStorage.setItem(
			"theme-location",
			JSON.stringify({ latitude: 78.2232, longitude: 15.6469 }),
		);
		mockSunCalc.getTimes.mockImplementation((date: Date) => {
			const isoDay = date.toISOString().slice(0, 10);
			if (isoDay === "2026-04-18") {
				return {
					...daylightTimes,
					solarNoon: new Date("2026-04-18T10:17:00.000Z"),
					sunrise: new Date("2026-04-17T23:42:32.649Z"),
					sunset: new Date("2026-04-18T22:52:17.693Z"),
				};
			}

			return {
				...daylightTimes,
				solarNoon: new Date(`${isoDay}T10:13:00.000Z`),
				sunrise: null,
				sunset: null,
			};
		});

		render(
			<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
				<Consumer />
			</ThemeProvider>,
		);

		expect(await screen.findByText("Resolved: light")).toBeTruthy();
		expect(screen.getByText("Time current: none")).toBeTruthy();
	});

	it("resolves dark before the first sunrise after polar night", async () => {
		useControlledTime("2026-08-09T13:00:00.000Z");
		window.localStorage.setItem("theme", "time");
		window.localStorage.setItem(
			"theme-location",
			JSON.stringify({ latitude: -75, longitude: -180 }),
		);
		mockSunCalc.getTimes.mockImplementation((date: Date) => {
			const isoDay = date.toISOString().slice(0, 10);
			if (isoDay === "2026-08-10") {
				return {
					...daylightTimes,
					solarNoon: new Date("2026-08-10T00:05:28.290Z"),
					sunrise: new Date("2026-08-09T23:26:03.407Z"),
					sunset: new Date("2026-08-10T00:46:22.864Z"),
				};
			}

			return {
				...daylightTimes,
				solarNoon: new Date(`${isoDay}T00:05:36.902Z`),
				sunrise: null,
				sunset: null,
			};
		});

		render(
			<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
				<Consumer />
			</ThemeProvider>,
		);

		expect(await screen.findByText("Resolved: dark")).toBeTruthy();
		expect(screen.getByText("Time next: light")).toBeTruthy();
		expect(screen.getByText("Time switch: 2026-08-09T23:26:03.407Z")).toBeTruthy();
	});

	it("skips adjacent boundaries that do not change the theme", async () => {
		useControlledTime("2026-09-22T03:00:00.000Z");
		window.localStorage.setItem("theme", "time");
		window.localStorage.setItem("theme-location", JSON.stringify({ latitude: -89, longitude: 24 }));
		const timesByDay = {
			"2026-09-21": {
				solarNoon: "2026-09-21T10:17:06.261Z",
				sunrise: "2026-09-21T03:50:36.462Z",
				sunset: "2026-09-21T17:35:52.686Z",
			},
			"2026-09-22": {
				solarNoon: "2026-09-22T10:16:45.047Z",
				sunrise: "2026-09-22T02:21:47.765Z",
				sunset: "2026-09-22T19:33:13.073Z",
			},
			"2026-09-23": {
				solarNoon: "2026-09-23T10:16:23.941Z",
				sunrise: "2026-09-22T15:44:58.115Z",
				sunset: "2026-09-23T16:55:20.200Z",
			},
		};
		mockSunCalc.getTimes.mockImplementation((date: Date) => {
			const times = timesByDay[date.toISOString().slice(0, 10) as keyof typeof timesByDay];
			return {
				...daylightTimes,
				solarNoon: new Date(times.solarNoon),
				sunrise: new Date(times.sunrise),
				sunset: new Date(times.sunset),
			};
		});

		render(
			<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
				<Consumer />
			</ThemeProvider>,
		);

		expect(await screen.findByText("Resolved: light")).toBeTruthy();
		expect(screen.getByText("Time next: dark")).toBeTruthy();
		expect(screen.getByText("Time switch: 2026-09-22T19:33:13.073Z")).toBeTruthy();
	});
});
