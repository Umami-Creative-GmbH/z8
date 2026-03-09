"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { use, useEffect } from "react";
import { toast } from "sonner";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { EmployeeCustomRolesCard } from "@/components/settings/custom-roles/employee-custom-roles-card";
import { EmployeeSkillsCard } from "@/components/settings/employee-skills-card";
import { ManagerAssignment } from "@/components/settings/manager-assignment";
import { RateHistoryCard } from "@/components/settings/rate-history-card";
import { useEmployee } from "@/lib/query/use-employee";
import { useRouter } from "@/navigation";
import { EmployeeDetailHeader, EmployeeEditFormCard, EmployeeOverviewCard } from "./page-sections";
import { defaultFormValues, syncEmployeeForm } from "./page-utils";

export default function EmployeeDetailPage({
	params,
}: {
	params: Promise<{ employeeId: string }>;
}) {
	const { employeeId } = use(params);
	const { t } = useTranslate();
	const router = useRouter();

	const {
		employee,
		schedule,
		availableManagers,
		rateHistory,
		isLoading,
		isLoadingRateHistory,
		hasEmployee,
		isAdmin,
		updateEmployee,
		isUpdating,
		updateRate,
		isUpdatingRate,
		refetch,
	} = useEmployee({ employeeId });

	const form = useForm({
		defaultValues: defaultFormValues,
		onSubmit: async ({ value }) => {
			const result = await updateEmployee(value).catch(() => null);

			if (!result) {
				toast.error("An unexpected error occurred");
				return;
			}

			if (result.success) {
				toast.success("Employee updated successfully");
				router.push("/settings/employees");
			} else {
				toast.error(result.error || "Failed to update employee");
			}
		},
	});

	useEffect(() => {
		if (employee) {
			syncEmployeeForm(form, employee);
		}
	}, [employee, form]);

	if (!hasEmployee && !isLoading) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature="manage employees" />
			</div>
		);
	}

	if (isLoading || !employee) {
		return (
			<div className="flex flex-1 flex-col gap-4 p-4">
				<div className="flex items-center justify-center p-8" role="status" aria-label="Loading employee data">
					<IconLoader2 className="size-8 animate-spin text-muted-foreground" aria-hidden="true" />
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<EmployeeDetailHeader t={t} />

			<div className="grid gap-4 lg:grid-cols-3">
				<EmployeeOverviewCard employee={employee} schedule={schedule} />
				<EmployeeEditFormCard
					form={form}
					isAdmin={isAdmin}
					isUpdating={isUpdating}
					onCancel={() => router.push("/settings/employees")}
				/>
			</div>

			{isAdmin && availableManagers.length > 0 && (
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
				isAdmin={isAdmin}
			/>

			<EmployeeSkillsCard
				employeeId={employeeId}
				organizationId={employee.organizationId}
				isAdmin={isAdmin}
			/>

			{employee.contractType === "hourly" && (
				<RateHistoryCard
					rateHistory={rateHistory}
					isLoading={isLoadingRateHistory}
					isAdmin={isAdmin}
					onAddRate={updateRate}
					isAddingRate={isUpdatingRate}
				/>
			)}
		</div>
	);
}
