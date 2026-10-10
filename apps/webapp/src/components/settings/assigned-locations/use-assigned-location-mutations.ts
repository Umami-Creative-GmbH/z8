"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import {
	type AssignedLocationInput,
	addAssignedLocationAction,
	removeAssignedLocationAction,
} from "@/app/[locale]/(app)/settings/locations/assigned-location-actions";
import type { AssignedLocationErrorCode } from "@/lib/time-tracking/assigned-locations/errors";
import { useAssignedLocationErrorMessage } from "./use-assigned-location-error";

/** Prefix of every assigned-location query; both settings cards refresh after a change. */
export const ASSIGNED_LOCATIONS_QUERY_KEY = ["assignedLocations"] as const;

class AssignedLocationActionError extends Error {
	constructor(readonly code: AssignedLocationErrorCode | null) {
		super(code ?? "failed");
	}
}

async function unwrap(
	action: Promise<{ success: true } | { success: false; code: AssignedLocationErrorCode }>,
) {
	const result = await action.catch(() => null);
	if (!result) throw new AssignedLocationActionError(null);
	if (!result.success) throw new AssignedLocationActionError(result.code);
}

/** Add and remove an assigned location, with toasts and a refresh of both cards. */
export function useAssignedLocationMutations() {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const errorMessage = useAssignedLocationErrorMessage();
	const onError = (error: Error) =>
		toast.error(errorMessage(error instanceof AssignedLocationActionError ? error.code : "failed"));
	const onSettled = () => queryClient.invalidateQueries({ queryKey: ASSIGNED_LOCATIONS_QUERY_KEY });

	const add = useMutation({
		mutationFn: (input: AssignedLocationInput) => unwrap(addAssignedLocationAction(input)),
		onSuccess: () =>
			toast.success(t("settings.assignedLocations.added", "Assigned location added")),
		onError,
		onSettled,
	});
	const remove = useMutation({
		mutationFn: (input: AssignedLocationInput) => unwrap(removeAssignedLocationAction(input)),
		onSuccess: () =>
			toast.success(t("settings.assignedLocations.removed", "Assigned location removed")),
		onError,
		onSettled,
	});

	return {
		add: (input: AssignedLocationInput) =>
			add.mutateAsync(input).then(
				() => true,
				() => false,
			),
		remove: (input: AssignedLocationInput) => remove.mutate(input),
		isMutating: add.isPending || remove.isPending,
	};
}
