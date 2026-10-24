"use client";

import type { ReactNode } from "react";
import type { OrganizationDisplayContext } from "@/lib/auth/organization-display-context";
import {
	type OrganizationSettingsBootstrap,
	OrganizationSettingsStoreProvider,
} from "@/stores/organization-settings-store";
import { OrganizationContextProvider } from "./organization-context-provider";

interface OrganizationSettingsProviderProps {
	children: ReactNode;
	initialSettings?: OrganizationSettingsBootstrap | null;
	/** Null uses the shared fallback read; omitted retains the settings-only provider. */
	initialContext?: OrganizationDisplayContext | null;
}

/**
 * Hydrate settings and share the authorized display context with client consumers.
 */
export function OrganizationSettingsProvider({
	children,
	initialSettings,
	initialContext,
}: OrganizationSettingsProviderProps) {
	if (initialContext !== undefined) {
		return (
			<OrganizationContextProvider initialContext={initialContext}>
				{children}
			</OrganizationContextProvider>
		);
	}
	return (
		<OrganizationSettingsStoreProvider initialSettings={initialSettings}>
			{children}
		</OrganizationSettingsStoreProvider>
	);
}
