"use client";

import {
	IconDots,
	IconLoader2,
	IconPlayerPause,
	IconPlayerPlay,
	IconUserOff,
} from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import type { ComponentPropsWithRef, ReactElement } from "react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
	deactivateEmployee,
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
import { EMPLOYEE_OFFBOARDING_RELEASE_READY } from "@/lib/employee-lifecycle/release";
import { queryKeys } from "@/lib/query";
import { Link } from "@/navigation";
import { EmployeeLifecycleActionError } from "./employee-lifecycle-error";

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
							`Employee actions for ${target.displayName}`,
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
	selectedAction: LifecycleAction | null;
}

function lifecycleDialogCopy(
	action: LifecycleAction | null,
	t: ReturnType<typeof useTranslate>["t"],
) {
	switch (action) {
		case "deactivate":
			return {
				title: t(
					"settings.employees.lifecycle.deactivateTitle",
					"Deactivate employee?",
				),
				description: t(
					"settings.employees.lifecycle.deactivateDescription",
					"This suspends access to this organization and ends sessions currently using it. Employee history is retained.",
				),
				action: t("settings.employees.lifecycle.deactivate", "Deactivate"),
				pending: t(
					"settings.employees.lifecycle.deactivating",
					"Deactivating...",
				),
				pendingStatus: t(
					"settings.employees.lifecycle.deactivatingStatus",
					"Deactivating employee",
				),
			};
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
	const isOwner = hasOrganizationRole(currentMemberRole, "owner");
	const isAdmin = hasOrganizationRole(currentMemberRole, "admin");
	const hasApprovedMembership = target.membership?.status === "approved";
	const targetIsOwner = hasOrganizationRole(target.membership?.role, "owner");
	const canChangeStatus =
		hasApprovedMembership && (isOwner || (isAdmin && !targetIsOwner));
	const canRemoveAccess = hasApprovedMembership && isOwner;

	const mutation = useMutation({
		mutationFn: ({
			action,
			target: selectedTarget,
		}: LifecycleActionSelection) => {
			switch (action) {
				case "deactivate":
					return requireActionSuccess(() =>
						deactivateEmployee(selectedTarget.employeeId),
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
			if (action === "remove") {
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
			setSelection(null);

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

			toast.success(
				selected.action === "deactivate"
					? t(
							"settings.employees.lifecycle.deactivateSuccess",
							"Employee deactivated",
						)
					: t(
							"settings.employees.lifecycle.reactivateSuccess",
							"Employee reactivated",
						),
			);
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

			const message =
				selected.action === "deactivate"
					? t(
							"settings.employees.lifecycle.deactivateError",
							"Failed to deactivate employee",
						)
					: selected.action === "reactivate"
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
		(target.userId === currentUserId || (!canChangeStatus && !canRemoveAccess))
	) {
		return null;
	}

	const handleConfirm = () => {
		if (!selection || actionLocked.current || mutation.isPending) return;
		actionLocked.current = true;
		mutation.mutate(selection);
	};
	const selectAction = (action: LifecycleAction) => {
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
			<LifecycleConfirmationDialog
				isPending={mutation.isPending}
				onConfirm={handleConfirm}
				onOpenChange={(open) => {
					if (!open && !mutation.isPending) setSelection(null);
				}}
				selectedAction={selection?.action ?? null}
			/>
		</>
	);
}
