"use client";

// Note: Temporal polyfill is loaded dynamically in schedule-x-wrapper.tsx
// before Schedule-X is rendered (required for Schedule-X v3+).

import { createContext, use, useEffect, useRef, useState } from "react";
import * as SunCalc from "suncalc";

type Theme = "light" | "dark" | "system" | "time";
type ResolvedTheme = "light" | "dark";
type ThemeLocation = { latitude: number; longitude: number };
type ThemeError = "location-required";
type TimeThemeInfo = {
	currentTheme: ResolvedTheme;
	nextSwitchAt: Date;
	nextTheme: ResolvedTheme;
};

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
	timeThemeInfo?: TimeThemeInfo;
	themes: string[];
};

const DEFAULT_THEMES = ["light", "dark"];
const TIME_THEME = "time";
const GEOLOCATION_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 2_147_483_647;
const DAY_MS = 86_400_000;
const ThemeContext = createContext<ThemeContextValue>({
	clearThemeError: () => {},
	setTheme: () => {},
	themes: [],
});

function getLocalStorage(): Storage | undefined {
	try {
		return typeof window === "undefined" ? undefined : window.localStorage;
	} catch {
		return undefined;
	}
}

function getSystemTheme(): ResolvedTheme {
	if (typeof window === "undefined" || !window.matchMedia) {
		return "light";
	}

	return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getLocationStorageKey(storageKey: string) {
	return `${storageKey}-location`;
}

function isValidLocation(value: unknown): value is ThemeLocation {
	if (!value || typeof value !== "object") {
		return false;
	}

	const { latitude, longitude } = value as Record<string, unknown>;
	return (
		typeof latitude === "number" &&
		typeof longitude === "number" &&
		Number.isFinite(latitude) &&
		Number.isFinite(longitude) &&
		latitude >= -90 &&
		latitude <= 90 &&
		longitude >= -180 &&
		longitude <= 180
	);
}

function readStoredLocation(storageKey: string): ThemeLocation | undefined {
	try {
		const value = getLocalStorage()?.getItem(getLocationStorageKey(storageKey));
		if (!value) {
			return undefined;
		}

		const parsed = JSON.parse(value) as unknown;
		return isValidLocation(parsed) ? parsed : undefined;
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

function isValidDate(value: Date | null | undefined): value is Date {
	return value instanceof Date && Number.isFinite(value.getTime());
}

function getSurroundingSunBoundaries(location: ThemeLocation, date: Date) {
	const boundaries: Array<{ at: Date; theme: ResolvedTheme }> = [];
	const candidates = [-1, 0, 1].map((dayOffset) => {
		const candidateDate = new Date(date.getTime() + dayOffset * DAY_MS);
		return SunCalc.getTimes(candidateDate, location.latitude, location.longitude);
	});
	const currentTimes = candidates.reduce((closest, times) =>
		Math.abs(times.solarNoon.getTime() - date.getTime()) <
		Math.abs(closest.solarNoon.getTime() - date.getTime())
			? times
			: closest,
	);
	if (!isValidDate(currentTimes.sunrise) || !isValidDate(currentTimes.sunset)) {
		return {};
	}
	const currentTheme: ResolvedTheme =
		date >= currentTimes.sunrise && date < currentTimes.sunset ? "light" : "dark";

	for (const times of candidates) {
		if (isValidDate(times.sunrise)) {
			boundaries.push({ at: times.sunrise, theme: "light" });
		}
		if (isValidDate(times.sunset)) {
			boundaries.push({ at: times.sunset, theme: "dark" });
		}
	}

	boundaries.sort((a, b) => a.at.getTime() - b.at.getTime());
	const next = boundaries.find((boundary) => boundary.at > date && boundary.theme !== currentTheme);

	return { currentTheme, next };
}

function resolveTimeTheme(
	location: ThemeLocation,
	systemTheme: ResolvedTheme,
	now = new Date(),
): ResolvedTheme {
	return getSurroundingSunBoundaries(location, now).currentTheme ?? systemTheme;
}

function getNextSunBoundary(location: ThemeLocation, now = new Date()) {
	return getSurroundingSunBoundaries(location, now).next?.at;
}

function getTimeThemeInfo(location: ThemeLocation, now = new Date()): TimeThemeInfo | undefined {
	const { currentTheme, next } = getSurroundingSunBoundaries(location, now);
	if (!currentTheme || !next) {
		return undefined;
	}

	return {
		currentTheme,
		nextSwitchAt: next.at,
		nextTheme: next.theme,
	};
}

function resolveTheme(
	theme: string | undefined,
	enableSystem: boolean,
	systemTheme: ResolvedTheme,
	location?: ThemeLocation,
): ResolvedTheme {
	if (theme === TIME_THEME) {
		return location ? resolveTimeTheme(location, systemTheme) : systemTheme;
	}

	return enableSystem && theme === "system" ? systemTheme : theme === "dark" ? "dark" : "light";
}

function writeStoredTheme(storageKey: string, theme: string) {
	try {
		getLocalStorage()?.setItem(storageKey, theme);
	} catch {
		// Keep the current session updated even when persistence is blocked.
	}
}

function requestThemeLocation(): Promise<ThemeLocation> {
	return new Promise((resolve, reject) => {
		if (typeof navigator === "undefined" || !navigator.geolocation) {
			reject(new Error("Geolocation is unavailable"));
			return;
		}

		navigator.geolocation.getCurrentPosition(
			(position) => {
				const location = {
					latitude: position.coords.latitude,
					longitude: position.coords.longitude,
				};

				if (isValidLocation(location)) {
					resolve(location);
					return;
				}

				reject(new Error("Geolocation returned invalid coordinates"));
			},
			(error) => reject(error),
			{
				enableHighAccuracy: false,
				maximumAge: 86_400_000,
				timeout: GEOLOCATION_TIMEOUT_MS,
			},
		);
	});
}

function disableTransitionsTemporarily() {
	if (typeof document === "undefined") {
		return;
	}

	const css = document.createElement("style");
	css.appendChild(document.createTextNode("*,*::before,*::after{transition:none!important}"));
	document.head.appendChild(css);

	window.getComputedStyle(document.body);
	setTimeout(() => css.remove(), 1);
}

function applyTheme({
	attribute,
	enableColorScheme,
	resolvedTheme,
	themes,
	value,
}: {
	attribute: NonNullable<ThemeProviderProps["attribute"]>;
	enableColorScheme: boolean;
	resolvedTheme: "light" | "dark";
	themes: string[];
	value?: Record<string, string>;
}) {
	if (typeof document === "undefined") {
		return;
	}

	const html = document.documentElement;
	const attributes = Array.isArray(attribute) ? attribute : [attribute];
	const resolvedValue = value?.[resolvedTheme] ?? resolvedTheme;
	const values = value ? Object.values(value) : themes;

	for (const item of attributes) {
		if (item === "class") {
			html.classList.remove(...values);
			html.classList.add(resolvedValue);
		} else {
			html.setAttribute(item, resolvedValue);
		}
	}

	if (enableColorScheme) {
		html.style.colorScheme = resolvedTheme;
	}
}

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
	const {
		attribute = "data-theme",
		defaultTheme,
		disableTransitionOnChange = false,
		enableColorScheme = true,
		enableSystem = true,
		storageKey = "theme",
		themes = DEFAULT_THEMES,
		value,
	} = props;
	const initialTheme = defaultTheme ?? (enableSystem ? "system" : "light");
	const [theme, setThemeState] = useState<string>(() => {
		try {
			return getLocalStorage()?.getItem(storageKey) ?? initialTheme;
		} catch {
			return initialTheme;
		}
	});
	const [location, setLocation] = useState<ThemeLocation | undefined>(() =>
		readStoredLocation(storageKey),
	);
	const [themeError, setThemeError] = useState<ThemeError | undefined>();
	const [, forceTimeThemeRefresh] = useState(0);
	const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => getSystemTheme());
	const locationRequestIdRef = useRef(0);
	const isMountedRef = useRef(true);
	const locationRef = useRef(location);
	const themeRef = useRef(theme);
	const resolvedTheme = resolveTheme(theme, enableSystem, systemTheme, location);
	const timeThemeInfo = theme === TIME_THEME && location ? getTimeThemeInfo(location) : undefined;

	useEffect(() => {
		isMountedRef.current = true;
		return () => {
			isMountedRef.current = false;
		};
	}, []);

	useEffect(() => {
		themeRef.current = theme;
	}, [theme]);

	useEffect(() => {
		locationRef.current = location;
	}, [location]);

	useEffect(() => {
		if (!enableSystem || typeof window === "undefined" || !window.matchMedia) {
			return;
		}

		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const updateSystemTheme = () => setSystemTheme(media.matches ? "dark" : "light");
		media.addEventListener("change", updateSystemTheme);

		return () => media.removeEventListener("change", updateSystemTheme);
	}, [enableSystem]);

	useEffect(() => {
		applyTheme({ attribute, enableColorScheme, resolvedTheme, themes, value });
	}, [attribute, enableColorScheme, resolvedTheme, themes, value]);

	useEffect(() => {
		if (theme !== TIME_THEME || !location || typeof window === "undefined") {
			return;
		}

		let timeout: number | undefined;
		let isCancelled = false;

		const scheduleNextUpdate = () => {
			if (isCancelled) {
				return;
			}

			const nextBoundary = getNextSunBoundary(location);
			if (!nextBoundary) {
				return;
			}

			const delay = Math.min(
				Math.max(nextBoundary.getTime() - Date.now() + 1000, 0),
				MAX_TIMEOUT_MS,
			);

			timeout = window.setTimeout(() => {
				forceTimeThemeRefresh((value) => value + 1);
				scheduleNextUpdate();
			}, delay);
		};

		scheduleNextUpdate();

		return () => {
			isCancelled = true;
			if (timeout !== undefined) {
				window.clearTimeout(timeout);
			}
		};
	}, [location, theme]);

	const clearThemeError = () => setThemeError(undefined);

	const setTheme: ThemeContextValue["setTheme"] = (nextTheme) => {
		const currentTheme = themeRef.current;
		const value = typeof nextTheme === "function" ? nextTheme(currentTheme) : nextTheme;

		if (value === TIME_THEME) {
			const storedLocation = locationRef.current;
			if (storedLocation) {
				if (disableTransitionOnChange) {
					disableTransitionsTemporarily();
				}
				setThemeError(undefined);
				writeStoredTheme(storageKey, value);
				themeRef.current = value;
				setThemeState(value);
				return;
			}

			const requestId = locationRequestIdRef.current + 1;
			locationRequestIdRef.current = requestId;
			void requestThemeLocation()
				.then((nextLocation) => {
					if (!isMountedRef.current || locationRequestIdRef.current !== requestId) {
						return;
					}

					if (disableTransitionOnChange) {
						disableTransitionsTemporarily();
					}
					setThemeError(undefined);
					setLocation(nextLocation);
					writeStoredLocation(storageKey, nextLocation);
					writeStoredTheme(storageKey, value);
					themeRef.current = value;
					setThemeState(value);
				})
				.catch(() => {
					if (!isMountedRef.current || locationRequestIdRef.current !== requestId) {
						return;
					}

					setThemeError("location-required");
				});
			return;
		}

		locationRequestIdRef.current += 1;
		themeRef.current = value;
		if (disableTransitionOnChange) {
			disableTransitionsTemporarily();
		}
		setThemeError(undefined);
		writeStoredTheme(storageKey, value);
		setThemeState(value);
	};

	const context = {
		clearThemeError,
		resolvedTheme,
		setTheme,
		systemTheme,
		theme,
		themeError,
		timeThemeInfo,
		themes: enableSystem ? [...themes, TIME_THEME, "system"] : [...themes, TIME_THEME],
	};

	return <ThemeContext.Provider value={context}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
	return use(ThemeContext);
}
