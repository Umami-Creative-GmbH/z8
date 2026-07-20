"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { use, useEffect } from "react";
import { toast } from "sonner";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { EmployeeLifecycleActions } from "@/components/organization/employee-lifecycle-actions";
import { EmployeeCustomRolesCard } from "@/components/settings/custom-roles/employee-custom-roles-card";
import { EmployeeEmploymentHistoryCard } from "@/components/settings/employee-employment-history-card";
import { EmployeeSkillsCard } from "@/components/settings/employee-skills-card";
import { ManagerAssignment } from "@/components/settings/manager-assignment";
import { RateHistoryCard } from "@/components/settings/rate-history-card";
import { WorkBalanceRecalculationCard } from "@/components/settings/work-balance-recalculation-card";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import { queryKeys } from "@/lib/query";
import { type EmployeeDetail, useEmployee } from "@/lib/query/use-employee";
import type { SettingsAccessTier } from "@/lib/settings-access";
import { useRouter } from "@/navigation";
import { EmployeeDraftActions } from "./employee-draft-actions";
import {
	EmployeeDetailHeader,
	EmployeeEditFormCard,
	EmployeeOverviewCard,
} from "./page-sections";
import {
	buildEmployeeUpdatePayload,
	defaultFormValues,
	focusFirstInvalidEmployeeDetailField,
	syncEmployeeForm,
} from "./page-utils";

function EmployeeDetailLifecycleActions({
	employee,
	currentUserId,
	currentMemberRole,
}: {
	employee: EmployeeDetail;
	currentUserId: string;
	currentMemberRole: string;
}) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	if (employee.kind !== "employee") return null;

	const updateLifecycleDetail = (
		targetEmployeeId: string,
		updates: Pick<EmployeeDetail, "isActive" | "membership">,
	) => {
		if (employee.id !== targetEmployeeId) return;
		queryClient.setQueryData<EmployeeDetail>(
			queryKeys.employees.detail(targetEmployeeId),
			(current) =>
				current?.kind === "employee" && current.id === targetEmployeeId
					? { ...current, ...updates }
					: current,
		);
	};

	return (
		<div className="flex w-full flex-wrap items-center justify-start gap-3 sm:w-auto sm:justify-end">
			{!employee.isActive && !employee.membership && (
				<p className="max-w-sm text-left text-sm text-muted-foreground sm:text-right">
					{t(
						"settings.employees.lifecycle.reinviteRequired",
						"This employee no longer has organization membership. Send a new invitation to restore access.",
					)}
				</p>
			)}
			<EmployeeLifecycleActions
				organizationId={employee.organizationId}
				target={{
					employeeId: employee.id,
					userId: employee.userId,
					displayName: buildAuthUserDisplayName(employee.user) || employee.id,
					isActive: employee.isActive,
					membership: employee.membership,
				}}
				currentUserId={currentUserId}
				currentMemberRole={currentMemberRole}
				onOptimisticStatusChange={(targetEmployeeId, isActive) =>
					updateLifecycleDetail(targetEmployeeId, {
						isActive,
						membership: employee.membership,
					})
				}
				onRemoved={(targetEmployeeId) =>
					updateLifecycleDetail(targetEmployeeId, {
						isActive: false,
						membership: null,
					})
				}
			/>
		</div>
	);
}

export function EmployeeDetailPageClient({
	params,
	accessTier,
	currentUserId,
	currentMemberRole,
}: {
	params: Promise<{ employeeId: string }>;
	accessTier: SettingsAccessTier;
	currentUserId: string;
	currentMemberRole: string;
}) {
	const { employeeId } = use(params);
	const { t } = useTranslate();
	const { push } = useRouter();

	const {
		employee,
		schedule,
		availableManagers,
		rateHistory,
		employmentHistory,
		workPolicies,
		isLoading,
		isLoadingRateHistory,
		hasEmployee,
		updateEmployee,
		isUpdating,
		updateRate,
		isUpdatingRate,
		createEmploymentHistory,
		isCreatingEmploymentHistory,
		confirmEmploymentHistory,
		isConfirmingEmploymentHistory,
		cancelEmploymentHistory,
		isCancelingEmploymentHistory,
		requestWorkBalanceRecalculation,
		isRequestingWorkBalanceRecalculation,
		refetch,
	} = useEmployee({ employeeId, accessTier });
	const canManageEmployeeDetails =
		accessTier === "orgAdmin" || accessTier === "manager";
	const canManageManagerAssignments = accessTier === "orgAdmin";
	const canManageSkills = accessTier === "orgAdmin" || accessTier === "manager";
	const canManageRates = accessTier === "orgAdmin" || accessTier === "manager";
	const canManageCustomRoles = accessTier === "orgAdmin";
	const canManageEmploymentHistory = accessTier === "orgAdmin";
	const isMutatingEmploymentHistory =
		isConfirmingEmploymentHistory || isCancelingEmploymentHistory;

	const form = useForm({
		defaultValues: defaultFormValues,
		onSubmitInvalid: ({ formApi }) =>
			focusFirstInvalidEmployeeDetailField(formApi),
		onSubmit: async ({ value }) => {
			const payload = buildEmployeeUpdatePayload(value);
			const result = await updateEmployee(payload).catch(() => null);

			if (!result) {
				toast.error(
					t(
						"settings.employees.detailView.unexpectedError",
						"An unexpected error occurred",
					),
				);
				return;
			}

			if (result.success) {
				toast.success(
					t(
						"settings.employees.detailView.updateSuccess",
						"Employee updated successfully",
					),
				);
				push("/settings/employees");
			} else {
				toast.error(
					result.error ||
						t(
							"settings.employees.detailView.updateFailed",
							"Failed to update employee",
						),
				);
			}
		},
	});

	useEffect(() => {
		if (employee) {
			syncEmployeeForm(form, employee);
		}
	}, [employee, form]);

	const handleWorkBalanceRecalculation = async () => {
		const result = await requestWorkBalanceRecalculation().catch(() => null);

		if (result?.success) {
			toast.success(
				t(
					"settings.workBalanceRecalculation.requestSuccess",
					"Work balance recalculation queued",
				),
			);
			return;
		}

		toast.error(
			result?.error ||
				t(
					"settings.workBalanceRecalculation.requestError",
					"Failed to queue work balance recalculation",
				),
		);
	};

	if (!hasEmployee && !isLoading) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError
					feature={t(
						"settings.employees.detailView.manageEmployees",
						"manage employees",
					)}
				/>
			</div>
		);
	}

	if (isLoading || !employee) {
		return (
			<div className="flex flex-1 flex-col gap-4 p-4">
				<output
					className="flex items-center justify-center p-8"
					aria-label={t(
						"settings.employees.detailView.loadingEmployeeData",
						"Loading employee data",
					)}
				>
					<IconLoader2
						className="size-8 animate-spin text-muted-foreground"
						aria-hidden="true"
					/>
				</output>
			</div>
		);
	}

	const isDraft = employee.kind === "invitationDraft";
	const isAcceptedDraft = isDraft && Boolean(employee.realEmployeeId);
	const canShowRealEmployeeSections = !isDraft;
	const canEditDraftDetails =
		!isAcceptedDraft && (!isDraft || !employee.realEmployeeId);
	const canManageDraftActions =
		isDraft &&
		accessTier === "orgAdmin" &&
		(hasOrganizationRole(currentMemberRole, "owner") ||
			hasOrganizationRole(currentMemberRole, "admin"));

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<EmployeeDetailHeader
				t={t}
				actions={
					<EmployeeDetailLifecycleActions
						employee={employee}
						currentUserId={currentUserId}
						currentMemberRole={currentMemberRole}
					/>
				}
			/>

			<div className="grid gap-4 lg:grid-cols-3">
				<EmployeeOverviewCard employee={employee} schedule={schedule} t={t} />
				{canEditDraftDetails && (
					<EmployeeEditFormCard
						form={form}
						canEditManagerFields={canManageEmployeeDetails}
						canEditOrgAdminFields={accessTier === "orgAdmin"}
						isUpdating={isUpdating}
						onCancel={() => push("/settings/employees")}
						t={t}
					/>
				)}
			</div>

			{canManageDraftActions && (
				<EmployeeDraftActions
					organizationId={employee.organizationId}
					encodedDraftEmployeeId={employee.encodedId}
					invitationId={employee.invitation.id}
					invitationStatus={employee.invitationStatus}
				/>
			)}

			{canShowRealEmployeeSections &&
				canManageManagerAssignments &&
				availableManagers.length > 0 && (
					<ManagerAssignment
						employeeId={employeeId}
						currentManagers={employee.managers || []}
						availableManagers={availableManagers}
						onSuccess={refetch}
					/>
				)}

			{canShowRealEmployeeSections && (
				<EmployeeCustomRolesCard
					employeeId={employeeId}
					organizationId={employee.organizationId}
					isAdmin={canManageCustomRoles}
				/>
			)}

			{canShowRealEmployeeSections && (
				<EmployeeSkillsCard
					employeeId={employeeId}
					organizationId={employee.organizationId}
					canManageSkills={canManageSkills}
				/>
			)}

			{canShowRealEmployeeSections && (
				<EmployeeEmploymentHistoryCard
					history={employmentHistory}
					canManage={canManageEmploymentHistory}
					onCreate={createEmploymentHistory}
					onConfirm={confirmEmploymentHistory}
					onCancel={cancelEmploymentHistory}
					isCreating={isCreatingEmploymentHistory}
					isMutating={isMutatingEmploymentHistory}
					workPolicies={workPolicies}
				/>
			)}

			{canShowRealEmployeeSections && accessTier === "orgAdmin" && (
				<WorkBalanceRecalculationCard
					employeeName={buildAuthUserDisplayName(employee.user) || employee.id}
					isPending={isRequestingWorkBalanceRecalculation}
					onRecalculate={handleWorkBalanceRecalculation}
					t={t}
				/>
			)}

			{canShowRealEmployeeSections && employee.contractType === "hourly" && (
				<RateHistoryCard
					rateHistory={rateHistory}
					isLoading={isLoadingRateHistory}
					isAdmin={canManageRates}
					onAddRate={updateRate}
					isAddingRate={isUpdatingRate}
				/>
			)}
		</div>
	);
}
