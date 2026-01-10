"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/auth-client";
import { ApiError, fetchApi } from "@/lib/fetch";

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

/**
 * Hook to get current organization and employee context for client components
 * Uses the session's activeOrganizationId and fetches employee context
 */
export function useOrganization(): OrganizationContext {
	const { data: session, isPending: sessionLoading } = useSession();
	const router = useRouter();
	const [employeeContext, setEmployeeContext] = useState<EmployeeContext | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const fetchEmployeeContext = useCallback(async () => {
		if (!session?.user?.id) {
			setIsLoading(false);
			return;
		}

		try {
			setIsLoading(true);
			setError(null);

			const data = await fetchApi<{ employee: EmployeeContext }>("/api/auth/context");
			setEmployeeContext(data.employee);
		} catch (err) {
			// Redirect to sign-in on 401 unauthorized
			if (err instanceof ApiError && err.isUnauthorized()) {
				router.replace("/sign-in");
				return;
			}
			setError(err instanceof Error ? err.message : "Unknown error");
			setEmployeeContext(null);
		} finally {
			setIsLoading(false);
		}
	}, [session?.user?.id, router]);

	useEffect(() => {
		if (!sessionLoading) {
			fetchEmployeeContext();
		}
	}, [sessionLoading, fetchEmployeeContext]);

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
