"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/auth-client";
import { ApiError, fetchApi } from "@/lib/fetch";
import { useRouter } from "@/navigation";
import { useOrganizationSettings } from "@/stores/organization-settings-store";

export interface OrganizationContext {
	organizationId: string | null;
	employeeId: string | null;
	role: "admin" | "manager" | "employee" | null;
	isLoading: boolean;
	error: string | null;
	isAdmin: boolean;
	isManager: boolean;
	isManagerOrAbove: boolean;
	refetch: () => Promise<void>;
}

interface EmployeeContext {
	employeeId: string;
	organizationId: string;
	role: "admin" | "manager" | "employee";
}

interface OrganizationSettingsResponse {
	organizationId: string;
	shiftsEnabled: boolean;
	projectsEnabled: boolean;
	surchargesEnabled: boolean;
	demoDataEnabled: boolean;
	worksCouncilEnabled: boolean;
	timezone: string;
	deletedAt: string | null;
}

/**
 * Hook to get current organization and employee context for client components
 * Uses the session's activeOrganizationId and fetches employee context
 * Also hydrates the organization settings Zustand store
 */
export function useOrganization(): OrganizationContext {
	const { data: session, isPending: sessionLoading } = useSession();
	const router = useRouter();
	const [employeeContext, setEmployeeContext] = useState<EmployeeContext | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const hydrateSettings = useOrganizationSettings((state) => state.hydrate);
	const resetSettings = useOrganizationSettings((state) => state.reset);

	// Track active organization to detect changes
	const activeOrganizationId = session?.session?.activeOrganizationId;

	const fetchEmployeeContext = useCallback(async () => {
		if (!session?.user?.id) {
			setIsLoading(false);
			return;
		}

		let shouldFinish = true;
		try {
			setIsLoading(true);
			setError(null);

			const data = await fetchApi<{
				employee: EmployeeContext;
				organizationSettings: OrganizationSettingsResponse | null;
			}>("/api/auth/context");
			setEmployeeContext(data.employee);

			// Hydrate organization settings store
			if (data.organizationSettings) {
				hydrateSettings(data.organizationSettings);
			} else {
				// Reset if no org settings (e.g., no active organization)
				resetSettings();
			}
		} catch (err) {
			// Redirect to sign-in on 401 unauthorized
			if (err instanceof ApiError && err.isUnauthorized()) {
				router.replace("/sign-in");
				shouldFinish = false;
				return;
			}
			setError(err instanceof Error ? err.message : "Unknown error");
			setEmployeeContext(null);
			resetSettings();
		}
		if (shouldFinish) {
			setIsLoading(false);
		}
	}, [session?.user?.id, router, hydrateSettings, resetSettings]);

	// Re-fetch when session loads or active organization changes
	useEffect(() => {
		if (!sessionLoading) {
			const timeout = setTimeout(() => void fetchEmployeeContext(), 0);
			return () => clearTimeout(timeout);
		}
	}, [sessionLoading, activeOrganizationId, fetchEmployeeContext]);

	const organizationId = employeeContext?.organizationId ?? null;
	const role = employeeContext?.role ?? null;

	return {
		organizationId,
		employeeId: employeeContext?.employeeId ?? null,
		role,
		isLoading: sessionLoading || isLoading,
		error,
		isAdmin: role === "admin",
		isManager: role === "manager",
		isManagerOrAbove: role === "admin" || role === "manager",
		refetch: fetchEmployeeContext,
	};
}
