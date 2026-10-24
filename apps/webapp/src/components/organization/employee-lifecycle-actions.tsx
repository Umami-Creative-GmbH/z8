"use client";

import {
	IconDots,
	IconLoader2,
	IconPlayerPause,
	IconPlayerPlay,
	IconUserOff,
} from "@tabler/icons-react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import type { ComponentPropsWithRef, ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
	deactivateEmployee,
	previewEmployeeDeactivation,
	reactivateEmployee,
	removeEmployeeAccess,
} from "@/app/[locale]/(app)/settings/employees/actions";
import type { EmployeeMembershipSummary } from "@/app/[locale]/(app)/settings/employees/employee-action-types";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import type { ServerActionResult } from "@/lib/effect/result";
import type { ReactivationChecklist } from "@/lib/employee-lifecycle/reactivation-checklist";
import { EMPLOYEE_OFFBOARDING_RELEASE_READY } from "@/lib/employee-lifecycle/release";
import { queryKeys } from "@/lib/query";
import { useRequestIdentity } from "@/lib/query/use-employee-offboarding";
import { Link, useRouter } from "@/navigation";
import {
	DeactivationPreviewDialog,
	type DeactivationReplacementPicks,
	useDeactivationDialogMessages,
} from "./deactivation-preview-dialog";
import { EmployeeLifecycleActionError } from "./employee-lifecycle-error";
import {
	fetchReactivationChecklist,
	ReactivationChecklistDialog,
	useReactivationChecklistMessages,
} from "./reactivation-checklist";

export interface EmployeeLifecycleTarget {
	employeeId: string;
	userId: string;
	displayName: string;
	isActive: boolean;
	membership: EmployeeMembershipSummary | null;
}

export interface EmployeeLifecycleActionsProps {
	organizationId: string;
	target: EmployeeLifecycleTarget;
	currentUserId: string;
	currentMemberRole: string;
	onOptimisticStatusChange?(employeeId: string, isActive: boolean): void;
	onRemoved?(employeeId: string): void;
	/** A single button-compatible element that forwards its ref and received DOM props. */
	trigger?: EmployeeLifecycleTriggerElement;
	/**
	 * Once offboarding is released, status changes go through the departure
	 * and rehire flow on the employee's detail page instead of flipping the
	 * active flag. Defaults to the server release gate.
	 */
	offboardingReleased?: boolean;
}

export type EmployeeLifecycleTriggerElement = ReactElement<
	ComponentPropsWithRef<"button">
>;

type LifecycleAction = "deactivate" | "reactivate" | "remove";
type LifecycleActionSelection = {
	action: LifecycleAction;
	organizationId: string;
	target: EmployeeLifecycleTarget;
};
type LifecycleMutationInput = LifecycleActionSelection & {
	/** Deactivate only: the confirmed picks and the request ID for this payload. */
	deactivation?: { replacementManagers: DeactivationReplacementPicks; requestId: string };
};

function translateLifecycleGuidance(
	t: ReturnType<typeof useTranslate>["t"],
	error: EmployeeLifecycleActionError,
) {
	switch (error.guidanceTranslationKey) {
		case "settings.employees.lifecycle.finalOwnerDeactivateGuidance":
			return t(
				"settings.employees.lifecycle.finalOwnerDeactivateGuidance",
				"Assign and activate another approved owner before deactivating this employee.",
			);
		case "settings.employees.lifecycle.finalOwnerRemoveGuidance":
			return t(
				"settings.employees.lifecycle.finalOwnerRemoveGuidance",
				"Assign and activate another approved owner before removing this employee's access.",
			);
		case "settings.employees.lifecycle.reinviteRequired":
			return t(
				"settings.employees.lifecycle.reinviteRequired",
				"This employee no longer has organization membership. Send a new invitation to restore access.",
			);
		default:
			return null;
	}
}

function snapshotTarget(
	target: EmployeeLifecycleTarget,
): EmployeeLifecycleTarget {
	return {
		...target,
		membership: target.membership ? { ...target.membership } : null,
	};
}

async function requireActionSuccess(
	action: () => Promise<ServerActionResult<void>>,
) {
	const result = await action();
	if (!result.success) throw new EmployeeLifecycleActionError(result);
	return result;
}

interface LifecycleActionsMenuProps {
	canChangeStatus: boolean;
	/** Status changes open the detail page's departure and rehire flow. */
	offboardingReleased: boolean;
	canRemoveAccess: boolean;
	isPending: boolean;
	onSelectAction(action: LifecycleAction): void;
	target: EmployeeLifecycleTarget;
	trigger?: EmployeeLifecycleTriggerElement;
}

function LifecycleActionsMenu({
	canChangeStatus,
	offboardingReleased,
	canRemoveAccess,
	isPending,
	onSelectAction,
	target,
	trigger,
}: LifecycleActionsMenuProps) {
	const { t } = useTranslate();

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild disabled={isPending}>
				{trigger ?? (
					<Button
						type="button"
						variant="ghost"
						size="icon"
						aria-label={t(
							"settings.employees.lifecycle.actionsLabel",
							"Employee actions for {name}",
							{ name: target.displayName },
						)}
					>
						<IconDots className="size-4" aria-hidden="true" />
					</Button>
				)}
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				{canChangeStatus && offboardingReleased && (
					<DropdownMenuItem asChild>
						<Link href={`/settings/employees/${target.employeeId}#offboarding`}>
							{target.isActive ? (
								<IconPlayerPause aria-hidden="true" />
							) : (
								<IconPlayerPlay aria-hidden="true" />
							)}
							{target.isActive
								? t("settings.employees.lifecycle.deactivate", "Deactivate")
								: t("settings.employees.lifecycle.reactivate", "Reactivate")}
						</Link>
					</DropdownMenuItem>
				)}
				{canChangeStatus && !offboardingReleased && (
					<DropdownMenuItem
						onClick={() =>
							onSelectAction(target.isActive ? "deactivate" : "reactivate")
						}
					>
						{target.isActive ? (
							<IconPlayerPause aria-hidden="true" />
						) : (
							<IconPlayerPlay aria-hidden="true" />
						)}
						{target.isActive
							? t("settings.employees.lifecycle.deactivate", "Deactivate")
							: t("settings.employees.lifecycle.reactivate", "Reactivate")}
					</DropdownMenuItem>
				)}
				{canChangeStatus && canRemoveAccess && <DropdownMenuSeparator />}
				{canRemoveAccess && (
					<DropdownMenuItem
						variant="destructive"
						onClick={() => onSelectAction("remove")}
					>
						<IconUserOff aria-hidden="true" />
						{t("settings.employees.lifecycle.removeAccess", "Remove access")}
					</DropdownMenuItem>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

interface LifecycleConfirmationDialogProps {
	isPending: boolean;
	onConfirm(): void;
	onOpenChange(open: boolean): void;
	/** Deactivate has its own preview dialog (#1440). */
	selectedAction: ConfirmedLifecycleAction | null;
}

type ConfirmedLifecycleAction = Exclude<LifecycleAction, "deactivate">;

function lifecycleDialogCopy(
	action: ConfirmedLifecycleAction | null,
	t: ReturnType<typeof useTranslate>["t"],
) {
	switch (action) {
		case "reactivate":
			return {
				title: t(
					"settings.employees.lifecycle.reactivateTitle",
					"Reactivate employee?",
				),
				description: t(
					"settings.employees.lifecycle.reactivateDescription",
					"This restores access to this organization using the existing employee record.",
				),
				action: t("settings.employees.lifecycle.reactivate", "Reactivate"),
				pending: t(
					"settings.employees.lifecycle.reactivating",
					"Reactivating...",
				),
				pendingStatus: t(
					"settings.employees.lifecycle.reactivatingStatus",
					"Reactivating employee",
				),
			};
		default:
			return {
				title: t(
					"settings.employees.lifecycle.removeTitle",
					"Remove organization access?",
				),
				description: t(
					"settings.employees.lifecycle.removeDescription",
					"This removes organization membership and ends organization sessions. Time records, absences, balances, employment history, and audits are retained.",
				),
				action: t("settings.employees.lifecycle.removeAccess", "Remove access"),
				pending: t(
					"settings.employees.lifecycle.removing",
					"Removing access...",
				),
				pendingStatus: t(
					"settings.employees.lifecycle.removingStatus",
					"Removing organization access",
				),
			};
	}
}

function LifecycleConfirmationDialog({
	isPending,
	onConfirm,
	onOpenChange,
	selectedAction,
}: LifecycleConfirmationDialogProps) {
	const { t } = useTranslate();
	const isRemove = selectedAction === "remove";
	const copy = lifecycleDialogCopy(selectedAction, t);

	return (
		<AlertDialog open={selectedAction !== null} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{copy.title}</AlertDialogTitle>
					<AlertDialogDescription>{copy.description}</AlertDialogDescription>
				</AlertDialogHeader>
				{isPending && (
					<span
						role="status"
						aria-label={copy.pendingStatus}
						aria-live="polite"
						className="sr-only"
					/>
				)}
				<AlertDialogFooter>
					<AlertDialogCancel disabled={isPending}>
						{t("common.cancel", "Cancel")}
					</AlertDialogCancel>
					<Button
						type="button"
						variant={isRemove ? "destructive" : "default"}
						disabled={isPending}
						onClick={onConfirm}
					>
						{isPending && (
							<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
						)}
						{isPending ? copy.pending : copy.action}
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

/** The dialog's message for a refused deactivation. */
function deactivationSubmitError(
	t: ReturnType<typeof useTranslate>["t"],
	messages: ReturnType<typeof useDeactivationDialogMessages>,
	error: unknown,
): string {
	if (error instanceof EmployeeLifecycleActionError) {
		const refusal = messages.refusal(error.refusal);
		if (refusal) return refusal;
		const guidance = translateLifecycleGuidance(t, error);
		if (guidance) return guidance;
	}
	return t("settings.employees.lifecycle.deactivateError", "Failed to deactivate employee");
}

export function EmployeeLifecycleActions({
	organizationId,
	target,
	currentUserId,
	currentMemberRole,
	onOptimisticStatusChange,
	onRemoved,
	trigger,
	offboardingReleased = EMPLOYEE_OFFBOARDING_RELEASE_READY,
}: EmployeeLifecycleActionsProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const actionLocked = useRef(false);
	const [selection, setSelection] = useState<LifecycleActionSelection | null>(
		null,
	);
	// Deactivate (#1440): the picks the preview is computed with, and one
	// request ID per unchanged payload so a retry replays instead of acting twice.
	const [replacementPicks, setReplacementPicks] = useState<DeactivationReplacementPicks>({});
	const [deactivationError, setDeactivationError] = useState<string | null>(null);
	const [reactivatedChecklist, setReactivatedChecklist] = useState<{
		employeeName: string;
		checklist: ReactivationChecklist;
	} | null>(null);
	const router = useRouter();
	const checklistMessages = useReactivationChecklistMessages();
	const deactivationIdentity = useRequestIdentity();
	const dialogMessages = useDeactivationDialogMessages();
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const isOwner = hasOrganizationRole(currentMemberRole, "owner");
	const isAdmin = hasOrganizationRole(currentMemberRole, "admin");
	const hasApprovedMembership = target.membership?.status === "approved";
	const targetIsOwner = hasOrganizationRole(target.membership?.role, "owner");
	const canChangeStatus =
		hasApprovedMembership && (isOwner || (isAdmin && !targetIsOwner));
	const canRemoveAccess = hasApprovedMembership && isOwner;

	const deactivating = selection?.action === "deactivate" ? selection : null;
	const previewEmployeeId = deactivating?.target.employeeId ?? target.employeeId;
	const previewKeyPrefix = [
		...queryKeys.employees.detail(previewEmployeeId),
		"deactivationPreview",
	] as const;
	const previewQuery = useQuery({
		queryKey: [...previewKeyPrefix, replacementPicks],
		queryFn: async () => {
			const result = await previewEmployeeDeactivation({
				employeeId: previewEmployeeId,
				replacementManagers: replacementPicks,
			});
			if (!result.success) throw new EmployeeLifecycleActionError(result);
			return result.data;
		},
		enabled: deactivating !== null,
		// While new picks recalculate, keep showing this employee's last preview.
		placeholderData: (previous, previousQuery) =>
			previousQuery &&
			JSON.stringify(previousQuery.queryKey.slice(0, -1)) === JSON.stringify(previewKeyPrefix)
				? keepPreviousData(previous)
				: undefined,
		staleTime: 0,
		retry: false,
	});

	const closeDialog = () => {
		setSelection(null);
		setReplacementPicks({});
		setDeactivationError(null);
	};

	/**
	 * Reactivation restores nothing (#1441): show what the deactivation ended,
	 * to grant again on purpose. When this row is gone by now (a filtered list),
	 * the toast links to the checklist on the employee page instead.
	 */
	const offerReactivationChecklist = async (reactivated: EmployeeLifecycleTarget) => {
		const checklist = await queryClient
			.fetchQuery({
				queryKey: queryKeys.employees.reactivationChecklist(reactivated.employeeId),
				queryFn: () => fetchReactivationChecklist(reactivated.employeeId),
				staleTime: 0,
			})
			.catch(() => null);
		const hasItems = checklist !== null && checklist.items.length > 0;
		if (hasItems && mounted.current) {
			setReactivatedChecklist({ employeeName: reactivated.displayName, checklist });
		}
		toast.success(
			t("settings.employees.lifecycle.reactivateSuccess", "Employee reactivated"),
			hasItems && !mounted.current
				? {
						action: {
							label: checklistMessages.openLabel,
							onClick: () =>
								router.push(`/settings/employees/${reactivated.employeeId}#reactivation-checklist`),
						},
					}
				: undefined,
		);
	};

	const mutation = useMutation({
		mutationFn: ({ action, target: selectedTarget, deactivation }: LifecycleMutationInput) => {
			switch (action) {
				case "deactivate":
					return requireActionSuccess(() =>
						deactivateEmployee({
							employeeId: selectedTarget.employeeId,
							requestId: deactivation?.requestId ?? "",
							replacementManagers: deactivation?.replacementManagers ?? {},
						}),
					);
				case "reactivate":
					return requireActionSuccess(() =>
						reactivateEmployee(selectedTarget.employeeId),
					);
				case "remove":
					return requireActionSuccess(() =>
						removeEmployeeAccess(selectedTarget.employeeId),
					);
			}
		},
		onMutate: ({ action, target: selectedTarget }) => {
			// A deactivation may be refused (a pick no longer eligible), so its row changes
			// only once the server confirmed it; the dialog stays open meanwhile (#1440).
			if (action === "remove" || action === "deactivate") {
				return {
					employeeId: selectedTarget.employeeId,
					previousIsActive: null,
				};
			}

			onOptimisticStatusChange?.(
				selectedTarget.employeeId,
				action === "reactivate",
			);
			return {
				employeeId: selectedTarget.employeeId,
				previousIsActive: selectedTarget.isActive,
			};
		},
		onSuccess: async (_result, selected) => {
			if (selected.action === "deactivate") {
				deactivationIdentity.complete();
				onOptimisticStatusChange?.(selected.target.employeeId, false);
			}
			const invalidations = [
				queryClient.invalidateQueries({
					queryKey: queryKeys.members.organization(selected.organizationId),
				}),
				queryClient.invalidateQueries({
					queryKey: queryKeys.employees.organization(selected.organizationId),
				}),
				queryClient.invalidateQueries({
					queryKey: queryKeys.employees.detail(selected.target.employeeId),
				}),
			];

			if (selected.action === "remove") {
				invalidations.push(
					queryClient.invalidateQueries({
						queryKey: queryKeys.organizations.all,
					}),
				);
			}

			await Promise.all(invalidations);
			closeDialog();

			if (selected.action === "reactivate") {
				await offerReactivationChecklist(selected.target);
				return;
			}

			if (selected.action === "remove") {
				onRemoved?.(selected.target.employeeId);
				toast.success(
					t(
						"settings.employees.lifecycle.removeSuccess",
						"Organization access removed",
					),
				);
				return;
			}

			toast.success(t("settings.employees.lifecycle.deactivateSuccess", "Employee deactivated"));
		},
		onError: (error, selected, context) => {
			if (
				context?.employeeId &&
				typeof context.previousIsActive === "boolean"
			) {
				onOptimisticStatusChange?.(
					context.employeeId,
					context.previousIsActive,
				);
			}

			if (selected.action === "deactivate") {
				// The dialog stays open with the server's guidance and a fresh preview.
				const message = deactivationSubmitError(t, dialogMessages, error);
				if (!mounted.current) {
					toast.error(message);
					return;
				}
				setDeactivationError(message);
				void previewQuery.refetch();
				return;
			}

			const message =
				selected.action === "reactivate"
					? t(
							"settings.employees.lifecycle.reactivateError",
							"Failed to reactivate employee",
						)
					: t(
							"settings.employees.lifecycle.removeError",
							"Failed to remove organization access",
						);

			const guidance =
				error instanceof EmployeeLifecycleActionError
					? translateLifecycleGuidance(t, error)
					: null;
			toast.error(guidance ?? message);
		},
		onSettled: () => {
			actionLocked.current = false;
		},
	});

	if (
		!selection &&
		!reactivatedChecklist &&
		(target.userId === currentUserId || (!canChangeStatus && !canRemoveAccess))
	) {
		return null;
	}

	const handleConfirm = () => {
		if (!selection || actionLocked.current || mutation.isPending) return;
		actionLocked.current = true;
		mutation.mutate(selection);
	};
	const handleDeactivationConfirm = (picks: DeactivationReplacementPicks) => {
		if (!deactivating || actionLocked.current || mutation.isPending) return;
		actionLocked.current = true;
		setDeactivationError(null);
		const payload = {
			employeeId: deactivating.target.employeeId,
			replacementManagers: picks,
		};
		mutation.mutate({
			...deactivating,
			deactivation: {
				replacementManagers: picks,
				requestId: deactivationIdentity.forPayload(payload),
			},
		});
	};
	const selectAction = (action: LifecycleAction) => {
		setDeactivationError(null);
		setReplacementPicks({});
		setSelection({
			action,
			organizationId,
			target: snapshotTarget(target),
		});
	};

	return (
		<>
			<LifecycleActionsMenu
				canChangeStatus={canChangeStatus}
				offboardingReleased={offboardingReleased}
				canRemoveAccess={canRemoveAccess}
				isPending={mutation.isPending}
				onSelectAction={selectAction}
				target={target}
				trigger={trigger}
			/>
			<DeactivationPreviewDialog
				open={deactivating !== null}
				onOpenChange={(open) => {
					if (!open && !mutation.isPending) closeDialog();
				}}
				employeeName={deactivating?.target.displayName ?? target.displayName}
				plan={deactivating ? (previewQuery.data ?? null) : null}
				isLoading={previewQuery.isFetching}
				loadError={previewQuery.isError && !previewQuery.data ? dialogMessages.loadError : null}
				onRetry={() => void previewQuery.refetch()}
				submitError={deactivationError}
				isSubmitting={mutation.isPending}
				onReplacementsChange={(picks) => {
					setDeactivationError(null);
					setReplacementPicks(picks);
				}}
				onConfirm={handleDeactivationConfirm}
			/>
			<LifecycleConfirmationDialog
				isPending={mutation.isPending}
				onConfirm={handleConfirm}
				onOpenChange={(open) => {
					if (!open && !mutation.isPending) closeDialog();
				}}
				selectedAction={selection && selection.action !== "deactivate" ? selection.action : null}
			/>
			<ReactivationChecklistDialog
				open={reactivatedChecklist !== null}
				onOpenChange={(open) => {
					if (!open) setReactivatedChecklist(null);
				}}
				employeeName={reactivatedChecklist?.employeeName ?? target.displayName}
				checklist={reactivatedChecklist?.checklist ?? null}
			/>
		</>
	);
}
