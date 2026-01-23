"use client";

// Note: Temporal polyfill is loaded dynamically in schedule-x-wrapper.tsx
// before Schedule-X is rendered (required for Schedule-X v3+).

import type { ThemeProviderProps } from "next-themes";
import { ThemeProvider as NextThemesProvider } from "next-themes";

interface ExtendedThemeProviderProps extends ThemeProviderProps {
	/** CSP nonce for inline scripts used by next-themes */
	nonce?: string;
}

export function ThemeProvider({ children, nonce, ...props }: ExtendedThemeProviderProps) {
	return (
		<NextThemesProvider nonce={nonce} {...props}>
			{children}
		</NextThemesProvider>
	);
}
