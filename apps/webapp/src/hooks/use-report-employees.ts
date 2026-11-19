"use client";

import { CancelledError, type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useMemo, useSyncExternalStore } from "react";
import { getAccessibleEmployeesAction } from "@/app/[locale]/(app)/reports/actions";
import type { SelectableEmployee } from "@/components/employee-select/types";
import { authClient, useSession } from "@/lib/auth-client";
import { queryKeys } from "@/lib/query/keys";
import type { AccessibleEmployee } from "@/lib/reports/types";

/**
 * Result of useReportEmployees hook
 */
export interface UseReportEmployeesResult {
	/** List of employees accessible for report generation */
	employees: SelectableEmployee[];
	/** Whether the data is currently loading */
	isLoading: boolean;
	/** Whether the current roster read is being retried or refreshed. */
	isRefetching: boolean;
	/** Retry only the still-current roster opening. */
	refetch: () => Promise<void>;
	/** Error if fetching failed */
	error: Error | null;
	/** Current employee (always first in the list if available) */
	currentEmployee: SelectableEmployee | null;
	/** Whether the current user can see multiple employees (manager/admin) */
	canViewMultiple: boolean;
}

/**
 * Transform AccessibleEmployee to SelectableEmployee format
 */
function transformAccessibleEmployee(emp: AccessibleEmployee): SelectableEmployee {
	return {
		id: emp.id,
		userId: emp.id, // Use same ID as seed for avatar
		firstName: emp.firstName,
		lastName: emp.lastName,
		pronouns: emp.pronouns,
		position: emp.position,
		role: emp.role,
		// Reports look at the past: former employees stay selectable, labelled (#1438).
		// Report rows carry no deactivation flag; the picker's field is derived from the
		// roster mark, so a former employee also reads as not active.
		isActive: !emp.isFormer,
		isFormer: emp.isFormer === true,
		// "Former since …" (#1439); null when the date isn't recorded.
		...(emp.isFormer === true && emp.formerSince !== undefined
			? { formerSince: emp.formerSince }
			: {}),
		teamId: null,
		user: {
			id: emp.id,
			firstName: emp.firstName,
			lastName: emp.lastName,
			name: emp.name,
			email: emp.email,
			image: emp.image,
		},
		team: null,
	};
}

type RosterKey = readonly unknown[];
let nextOpeningId = 0;

function createRosterOpening(
	client: QueryClient,
	prefix: RosterKey,
	scope: string,
	ready: boolean,
) {
	let key: RosterKey | null = null;

	function retire() {
		const retiredKey = key;
		key = null;
		if (retiredKey) {
			// A server action may still settle. Only retire this observer's exact cache entry.
			void client.cancelQueries({ queryKey: retiredKey, exact: true }).then(() => {
				client.removeQueries({ queryKey: retiredKey, exact: true });
			});
		}
	}

	return {
		getSnapshot: () => key,
		subscribe(notify: () => void) {
			if (!ready) return () => {};
			key = [...prefix, ++nextOpeningId];
			let previous = scope;
			const unsubscribe = authClient.$store.atoms.session.subscribe((value) => {
				const next = JSON.stringify([
					value.data?.user.id,
					value.data?.session.activeOrganizationId,
				]);
				if (next === previous) return;
				previous = next;
				retire();
				if (next === scope) key = [...prefix, ++nextOpeningId];
				notify();
			});
			return () => {
				unsubscribe();
				retire();
			};
		},
	};
}

const getServerRosterOpening = () => null;

/**
 * Hook to fetch employees accessible for report generation.
 *
 * Returns employees based on the current user's role:
 * - Employees: Only themselves (canViewMultiple: false)
 * - Managers: Themselves + managed employees (canViewMultiple: true)
 * - Admins: All employees in organization (canViewMultiple: true)
 *
 * Uses React Query for caching with 5-minute stale time since
 * employee lists don't change frequently.
 *
 * @param currentEmployeeId - The current user's employee ID (used for query key)
 */
export function useReportEmployees(currentEmployeeId?: string): UseReportEmployeesResult {
	const client = useQueryClient();
	const session = useSession();
	const actor = session.data?.user.id;
	const organization = session.data?.session.activeOrganizationId;
	const scope = JSON.stringify([actor, organization]);
	const ready = !session.isPending && !!actor && !!organization && !!currentEmployeeId;
	const openingId = useId();
	const prefix = useMemo(
		() => [...queryKeys.reports.employees(currentEmployeeId ?? ""), actor, organization, openingId],
		[currentEmployeeId, actor, organization, openingId],
	);
	const opening = useMemo(
		() => createRosterOpening(client, prefix, scope, ready),
		[client, prefix, scope, ready],
	);
	const key = useSyncExternalStore(opening.subscribe, opening.getSnapshot, getServerRosterOpening);
	const admitted = key !== null;
	const { data, isLoading, isRefetching, error, refetch } = useQuery({
		queryKey: key ?? [...prefix, "pending"],
		queryFn: async ({ signal }) => {
			if (signal.aborted || opening.getSnapshot() !== key)
				throw new CancelledError({ silent: true });
			const result = await getAccessibleEmployeesAction();
			if (signal.aborted || opening.getSnapshot() !== key)
				throw new CancelledError({ silent: true });
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch accessible employees");
			}
			return result.data;
		},
		staleTime: 5 * 60 * 1000, // 5 minutes - employee lists don't change frequently
		gcTime: 0, // An unobserved opening is retired, including the disabled placeholder.
		enabled: admitted,
	});

	// Transform AccessibleEmployee[] to SelectableEmployee[]
	const employees = (() => {
		if (!admitted || !data) return [];
		return data.map(transformAccessibleEmployee);
	})();

	// First employee is always the current user
	const currentEmployee = employees.length > 0 ? employees[0] : null;

	// Can view multiple if more than one employee in the list
	const canViewMultiple = employees.length > 1;

	return {
		employees,
		isLoading: !admitted || isLoading,
		isRefetching: admitted && isRefetching,
		refetch: async () => {
			if (!admitted || opening.getSnapshot() !== key) return;
			await refetch({ cancelRefetch: false });
		},
		error: admitted && error instanceof Error ? error : null,
		currentEmployee,
		canViewMultiple,
	};
}
