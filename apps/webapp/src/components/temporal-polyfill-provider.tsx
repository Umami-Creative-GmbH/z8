"use client";

// This component exists solely to ensure the Temporal polyfill
// is loaded as early as possible in the client-side bundle.
// Import it at the top of your root layout or providers.

// Import the polyfill synchronously - this patches globalThis.Temporal
import "temporal-polyfill/global";

import type { ReactNode } from "react";

interface TemporalPolyfillProviderProps {
	children: ReactNode;
}

/**
 * Provider component that ensures the Temporal polyfill is loaded.
 * This must be rendered as early as possible in the component tree,
 * before any components that use Temporal API (like Schedule-X calendar).
 */
export function TemporalPolyfillProvider({ children }: TemporalPolyfillProviderProps) {
	return <>{children}</>;
}
