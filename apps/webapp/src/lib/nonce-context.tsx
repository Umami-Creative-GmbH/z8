"use client";

import { createContext, type ReactNode, useContext } from "react";

const NonceContext = createContext<string | undefined>(undefined);

interface NonceProviderProps {
	nonce: string | undefined;
	children: ReactNode;
}

/**
 * Provider for distributing CSP nonce to client components
 */
export function NonceProvider({ nonce, children }: NonceProviderProps) {
	return (
		<NonceContext.Provider value={nonce}>{children}</NonceContext.Provider>
	);
}

/**
 * Hook to access the CSP nonce in client components
 * Used for inline scripts and styles that need nonce attributes
 */
export function useNonce(): string | undefined {
	return useContext(NonceContext);
}
