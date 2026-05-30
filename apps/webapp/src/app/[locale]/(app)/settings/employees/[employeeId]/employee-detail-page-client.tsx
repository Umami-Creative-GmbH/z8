"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { use, useEffect } from "react";
import { toast } from "sonner";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { EmployeeCustomRolesCard } from "@/components/settings/custom-roles/employee-custom-roles-card";
import { EmployeeEmploymentHistoryCard } from "@/components/settings/employee-employment-history-card";
import { EmployeeSkillsCard } from "@/components/settings/employee-skills-card";
import { ManagerAssignment } from "@/components/settings/manager-assignment";
import { RateHistoryCard } from "@/components/settings/rate-history-card";
import { WorkBalanceRecalculationCard } from "@/components/settings/work-balance-recalculation-card";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import { useEmployee } from "@/lib/query/use-employee";
import type { SettingsAccessTier } from "@/lib/settings-access";
import { useRouter } from "@/navigation";
import { EmployeeDetailHeader, EmployeeEditFormCard, EmployeeOverviewCard } from "./page-sections";
import {
	buildEmployeeUpdatePayload,
	defaultFormValues,
	focusFirstInvalidEmployeeDetailField,
	syncEmployeeForm,
} from "./page-utils";

export function EmployeeDetailPageClient({
	params,
	accessTier,
}: {
	params: Promise<{ employeeId: string }>;
	accessTier: SettingsAccessTier;
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
	const canManageEmployeeDetails = accessTier === "orgAdmin" || accessTier === "manager";
	const canManageManagerAssignments = accessTier === "orgAdmin";
	const canManageSkills = accessTier === "orgAdmin" || accessTier === "manager";
	const canManageRates = accessTier === "orgAdmin" || accessTier === "manager";
	const canManageCustomRoles = accessTier === "orgAdmin";
	const canManageEmploymentHistory = accessTier === "orgAdmin";
	const isMutatingEmploymentHistory = isConfirmingEmploymentHistory || isCancelingEmploymentHistory;

	const form = useForm({
		defaultValues: defaultFormValues,
		onSubmitInvalid: ({ formApi }) => focusFirstInvalidEmployeeDetailField(formApi),
		onSubmit: async ({ value }) => {
			const payload = buildEmployeeUpdatePayload(value);
			const result = await updateEmployee(payload).catch(() => null);

			if (!result) {
				toast.error(
					t("settings.employees.detailView.unexpectedError", "An unexpected error occurred"),
				);
				return;
			}

			if (result.success) {
				toast.success(
					t("settings.employees.detailView.updateSuccess", "Employee updated successfully"),
				);
				push("/settings/employees");
			} else {
				toast.error(
					result.error ||
						t("settings.employees.detailView.updateFailed", "Failed to update employee"),
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
				t("settings.workBalanceRecalculation.requestSuccess", "Work balance recalculation queued"),
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
					feature={t("settings.employees.detailView.manageEmployees", "manage employees")}
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
					<IconLoader2 className="size-8 animate-spin text-muted-foreground" aria-hidden="true" />
				</output>
			</div>
		);
	}

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<EmployeeDetailHeader t={t} />

			<div className="grid gap-4 lg:grid-cols-3">
				<EmployeeOverviewCard employee={employee} schedule={schedule} t={t} />
				<EmployeeEditFormCard
					form={form}
					canEditManagerFields={canManageEmployeeDetails}
					canEditOrgAdminFields={accessTier === "orgAdmin"}
					isUpdating={isUpdating}
					onCancel={() => push("/settings/employees")}
					t={t}
				/>
			</div>

			{canManageManagerAssignments && availableManagers.length > 0 && (
				<ManagerAssignment
					employeeId={employeeId}
					currentManagers={employee.managers || []}
					availableManagers={availableManagers}
					onSuccess={refetch}
				/>
			)}

			<EmployeeCustomRolesCard
				employeeId={employeeId}
				organizationId={employee.organizationId}
				isAdmin={canManageCustomRoles}
			/>

			<EmployeeSkillsCard
				employeeId={employeeId}
				organizationId={employee.organizationId}
				canManageSkills={canManageSkills}
			/>

			<EmployeeEmploymentHistoryCard
				history={employmentHistory}
				canManage={canManageEmploymentHistory}
				onCreate={createEmploymentHistory}
				onConfirm={confirmEmploymentHistory}
				onCancel={cancelEmploymentHistory}
				isCreating={isCreatingEmploymentHistory}
				isMutating={isMutatingEmploymentHistory}
			/>

			{accessTier === "orgAdmin" && (
				<WorkBalanceRecalculationCard
					employeeName={buildAuthUserDisplayName(employee.user) || employee.id}
					isPending={isRequestingWorkBalanceRecalculation}
					onRecalculate={handleWorkBalanceRecalculation}
					t={t}
				/>
			)}

			{employee.contractType === "hourly" && (
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
