"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import {
	assignDepartureReplacementAction,
	cancelEmployeeDepartureAction,
	getEmployeeOffboardingViewAction,
	offboardEmployeeNowAction,
	previewEmployeeDepartureAction,
	rehireEmployeeAction,
	resolveDepartureReviewAction,
	retryDepartureTaskAction,
	scheduleEmployeeDepartureAction,
} from "@/app/[locale]/(app)/settings/employees/employee-offboarding.actions";
import type { ServerActionResult } from "@/lib/effect/result";
import { queryKeys } from "./keys";

function sortKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, entry]) => [key, sortKeys(entry)]),
		);
	}
	return value;
}

/**
 * One request ID per unchanged submission: a retry of the same payload reuses
 * it so the server replays instead of acting twice, a changed payload gets a
 * new one, and `complete` starts fresh after success.
 */
export function createRequestIdentity(generate: () => string = () => crypto.randomUUID()) {
	let current: { fingerprint: string; requestId: string } | null = null;
	return {
		forPayload(payload: object): string {
			const fingerprint = JSON.stringify(sortKeys(payload));
			if (!current || current.fingerprint !== fingerprint) {
				current = { fingerprint, requestId: generate() };
			}
			return current.requestId;
		},
		complete() {
			current = null;
		},
	};
}

export function useRequestIdentity() {
	const identity = useRef<ReturnType<typeof createRequestIdentity> | null>(null);
	if (!identity.current) identity.current = createRequestIdentity();
	return identity.current;
}

async function unwrap<T>(promise: Promise<ServerActionResult<T>>): Promise<T> {
	const result = await promise;
	if (!result.success) throw new Error(result.error || "Request failed");
	return result.data as T;
}

/**
 * Lifecycle view and commands for one employee. Results come only from the
 * server: nothing is updated optimistically, so a scheduled employee never
 * appears inactive early. Every settled command refreshes the view (a cutoff
 * may have passed meanwhile); a successful one also refreshes the employee,
 * directory, employment history, calendar selection and billing summaries.
 */
export function useEmployeeOffboarding(options: {
	organizationId: string;
	employeeId: string;
	enabled?: boolean;
}) {
	const { organizationId, employeeId, enabled = true } = options;
	const queryClient = useQueryClient();
	const viewKey = queryKeys.employees.offboarding(organizationId, employeeId);

	const viewQuery = useQuery({
		queryKey: viewKey,
		queryFn: () => unwrap(getEmployeeOffboardingViewAction({ employeeId })),
		enabled,
		staleTime: 15 * 1000,
	});

	const refreshAfter = async <T>(result: ServerActionResult<T>) => {
		const refreshes = [queryClient.invalidateQueries({ queryKey: viewKey })];
		if (result.success) {
			refreshes.push(
				queryClient.invalidateQueries({ queryKey: queryKeys.employees.detail(employeeId) }),
				queryClient.invalidateQueries({
					queryKey: queryKeys.employees.organization(organizationId),
				}),
				queryClient.invalidateQueries({ queryKey: ["calendar", "employees"] }),
				queryClient.invalidateQueries({ queryKey: ["billing"] }),
			);
		}
		await Promise.all(refreshes);
	};

	const scheduleMutation = useMutation({
		mutationFn: scheduleEmployeeDepartureAction,
		onSettled: (result) => (result ? refreshAfter(result) : undefined),
	});
	const cancelMutation = useMutation({
		mutationFn: cancelEmployeeDepartureAction,
		onSettled: (result) => (result ? refreshAfter(result) : undefined),
	});
	const offboardNowMutation = useMutation({
		mutationFn: offboardEmployeeNowAction,
		onSettled: (result) => (result ? refreshAfter(result) : undefined),
	});
	const rehireMutation = useMutation({
		mutationFn: rehireEmployeeAction,
		onSettled: (result) => (result ? refreshAfter(result) : undefined),
	});
	const resolveReviewMutation = useMutation({
		mutationFn: resolveDepartureReviewAction,
		onSettled: (result) => (result ? refreshAfter(result) : undefined),
	});
	const retryTaskMutation = useMutation({
		mutationFn: retryDepartureTaskAction,
		onSettled: (result) => (result ? refreshAfter(result) : undefined),
	});
	const assignReplacementMutation = useMutation({
		mutationFn: assignDepartureReplacementAction,
		onSettled: (result) => (result ? refreshAfter(result) : undefined),
	});

	return {
		view: viewQuery.data ?? null,
		isLoading: viewQuery.isLoading,
		error: viewQuery.error,
		refetch: viewQuery.refetch,
		scheduleDeparture: scheduleMutation.mutateAsync,
		cancelDeparture: cancelMutation.mutateAsync,
		offboardNow: offboardNowMutation.mutateAsync,
		rehire: rehireMutation.mutateAsync,
		resolveReview: resolveReviewMutation.mutateAsync,
		retryTask: retryTaskMutation.mutateAsync,
		assignReplacement: assignReplacementMutation.mutateAsync,
		isMutating:
			scheduleMutation.isPending ||
			cancelMutation.isPending ||
			offboardNowMutation.isPending ||
			rehireMutation.isPending ||
			resolveReviewMutation.isPending ||
			retryTaskMutation.isPending ||
			assignReplacementMutation.isPending,
	};
}

/**
 * Advisory server preview of a departure; a null last working day previews an
 * immediate departure. It has no side effects and submit revalidates it.
 */
export function useDeparturePreview(options: {
	organizationId: string;
	employeeId: string;
	lastWorkingDay: string | null;
	enabled: boolean;
}) {
	const { organizationId, employeeId, lastWorkingDay, enabled } = options;
	return useQuery({
		queryKey: queryKeys.employees.offboardingPreview(organizationId, employeeId, lastWorkingDay),
		queryFn: () => unwrap(previewEmployeeDepartureAction({ employeeId, lastWorkingDay })),
		enabled,
		staleTime: 0,
		retry: false,
	});
}
