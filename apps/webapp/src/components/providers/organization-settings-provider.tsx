"use client";

import type { ReactNode } from "react";
import { useOrganization } from "@/hooks/use-organization";

interface OrganizationSettingsProviderProps {
	children: ReactNode;
}

/**
 * Provider component that ensures the organization settings store is hydrated.
 * Uses the useOrganization hook which fetches context and hydrates the store.
 */
export function OrganizationSettingsProvider({ children }: OrganizationSettingsProviderProps) {
	// This hook fetches auth context and hydrates the organization settings store
	useOrganization();

	return <>{children}</>;
}
