"use client";

import { createContext, type ReactNode, useContext } from "react";
import type {
	AuthConfig,
	DomainAuthContext as DomainAuthContextType,
	OrganizationBranding,
} from "@/lib/domain";

interface DomainAuthProviderProps {
	children: ReactNode;
	domainContext: DomainAuthContextType | null;
}

const DomainAuthContext = createContext<DomainAuthContextType | null>(null);

export function DomainAuthProvider({ children, domainContext }: DomainAuthProviderProps) {
	return <DomainAuthContext.Provider value={domainContext}>{children}</DomainAuthContext.Provider>;
}

export function useDomainAuth(): DomainAuthContextType | null {
	return useContext(DomainAuthContext);
}

export function useBranding(): OrganizationBranding | null {
	const context = useContext(DomainAuthContext);
	return context?.branding ?? null;
}

export function useAuthConfig(): AuthConfig | null {
	const context = useContext(DomainAuthContext);
	return context?.authConfig ?? null;
}
