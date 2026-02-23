"use client";

// Note: Temporal polyfill is loaded dynamically in schedule-x-wrapper.tsx
// before Schedule-X is rendered (required for Schedule-X v3+).

import type { ThemeProviderProps } from "next-themes";
import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
	return (
		<NextThemesProvider {...props}>
			{children}
		</NextThemesProvider>
	);
}
