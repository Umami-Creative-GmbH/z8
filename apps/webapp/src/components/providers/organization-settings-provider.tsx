"use client";

import type { ReactNode } from "react";
import {
	type OrganizationSettingsBootstrap,
	OrganizationSettingsStoreProvider,
} from "@/stores/organization-settings-store";

interface OrganizationSettingsProviderProps {
	children: ReactNode;
	initialSettings?: OrganizationSettingsBootstrap | null;
}

/**
 * Provider component that ensures the organization settings store is hydrated.
 * Uses the useOrganization hook which fetches context and hydrates the store.
 */
export function OrganizationSettingsProvider({
	children,
	initialSettings,
}: OrganizationSettingsProviderProps) {
	return (
		<OrganizationSettingsStoreProvider initialSettings={initialSettings}>
			{children}
		</OrganizationSettingsStoreProvider>
	);
}
