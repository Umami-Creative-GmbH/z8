"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { getAvailableEmployees } from "@/app/[locale]/(app)/settings/locations/actions";
import { assignSubareaEmployee } from "@/app/[locale]/(app)/settings/locations/assignment-actions";
import { EmployeeSingleSelect, toSelectableEmployee } from "@/components/employee-select";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import { queryKeys } from "@/lib/query";

interface SubareaEmployeeDialogProps {
	subareaId: string;
	subareaName: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSuccess: () => void;
}

interface FormValues {
	employeeId: string;
	isPrimary: boolean;
}

type EmployeeNameFields = {
	firstName: string | null;
	lastName: string | null;
	user: { name: string | null; email: string };
};

function getEmployeeName(emp: EmployeeNameFields) {
	if (emp.firstName || emp.lastName) {
		return `${emp.firstName || ""} ${emp.lastName || ""}`.trim();
	}
	return emp.user.name || emp.user.email;
}

export function SubareaEmployeeDialog(props: SubareaEmployeeDialogProps) {
	const { subareaId, open } = props;
	const formKey = open ? `${subareaId}:open` : `${subareaId}:closed`;

	return <SubareaEmployeeDialogContent key={formKey} {...props} />;
}

function SubareaEmployeeDialogContent({
	subareaId,
	subareaName,
	open,
	onOpenChange,
	onSuccess,
}: SubareaEmployeeDialogProps) {
	const { t } = useTranslate();
	const [isSubmitting, setIsSubmitting] = useState(false);

	const form = useForm({
		defaultValues: {
			employeeId: "",
			isPrimary: false,
		} as FormValues,
		onSubmit: async ({ value }) => {
			if (!value.employeeId) {
				toast.error(t("settings.locations.selectEmployee", "Please select an employee"));
				return;
			}

			setIsSubmitting(true);
			const result = await assignSubareaEmployee({
				subareaId,
				employeeId: value.employeeId,
				isPrimary: value.isPrimary,
			}).then(
				(response) => response,
				() => null,
			);

			if (result?.success) {
				toast.success(t("settings.locations.employeeAssigned", "Employee assigned"));
				onSuccess();
				onOpenChange(false);
			} else {
				toast.error(
					actionErrorMessage(t, result, {}, [
						"settings.locations.employeeAssignFailed",
						"Failed to assign employee",
					]),
				);
			}

			setIsSubmitting(false);
		},
	});

	function handleOpenChange(nextOpen: boolean) {
		if (nextOpen) {
			form.reset();
		}
		onOpenChange(nextOpen);
	}

	// Fetch available employees
	const { data: employees, isLoading } = useQuery({
		queryKey: [...queryKeys.locations.subareas.employees(subareaId), "available"],
		queryFn: async () => {
			const result = await getAvailableEmployees({ excludeSubareaId: subareaId });
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch employees");
			}
			return result.data;
		},
		enabled: open,
	});

	return (
		<ActionPanel open={open} onOpenChange={handleOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>
						{t("settings.locations.assignEmployeeToSubarea", "Assign Employee to Subarea")}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{t(
							"settings.locations.assignEmployeeToSubareaDescription",
							"Assign an employee as a supervisor for {subareaName}",
							{ subareaName },
						)}
					</ActionPanelDescription>
				</ActionPanelHeader>

				{isLoading ? (
					<ActionPanelBody className="space-y-4">
						<Skeleton className="h-10 w-full" />
						<Skeleton className="h-10 w-full" />
					</ActionPanelBody>
				) : employees?.length === 0 ? (
					<ActionPanelBody className="text-center text-muted-foreground">
						{t(
							"settings.locations.noAvailableEmployeesSubarea",
							"All employees are already assigned to this subarea",
						)}
					</ActionPanelBody>
				) : (
					<form
						onSubmit={(e) => {
							e.preventDefault();
							form.handleSubmit();
						}}
						className="flex min-h-0 flex-1 flex-col"
					>
						<ActionPanelBody className="space-y-4">
							{/* Employee Selection */}
							<form.Field name="employeeId">
								{(field) => (
									<EmployeeSingleSelect
										label={t("settings.locations.employee", "Employee")}
										placeholder={t(
											"settings.locations.selectEmployeePlaceholder",
											"Select an employee",
										)}
										value={field.state.value || null}
										onChange={(value) => field.handleChange(value ?? "")}
										onBlur={field.handleBlur}
										employees={(employees ?? []).map((emp) =>
											toSelectableEmployee({
												id: emp.id,
												firstName: emp.firstName,
												lastName: emp.lastName,
												name: getEmployeeName(emp),
												email: emp.user.email,
											}),
										)}
									/>
								)}
							</form.Field>

							{/* Primary Supervisor Checkbox */}
							<form.Field name="isPrimary">
								{(field) => (
									<div className="flex items-center gap-x-2">
										<Checkbox
											id="isPrimary-subarea"
											checked={field.state.value}
											onCheckedChange={(checked) => field.handleChange(checked === true)}
										/>
										<div className="grid gap-1.5 leading-none">
											<Label htmlFor="isPrimary-subarea" className="cursor-pointer">
												{t("settings.locations.primarySupervisor", "Primary Supervisor")}
											</Label>
											<p className="text-xs text-muted-foreground">
												{t(
													"settings.locations.primarySupervisorSubareaHelp",
													"Mark as the main supervisor for this subarea",
												)}
											</p>
										</div>
									</div>
								)}
							</form.Field>
						</ActionPanelBody>

						<ActionPanelFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => onOpenChange(false)}
								disabled={isSubmitting}
							>
								{t("common.cancel", "Cancel")}
							</Button>
							<Button type="submit" disabled={isSubmitting || !employees?.length}>
								{isSubmitting && <IconLoader2 className="mr-2 size-4 animate-spin" />}
								{t("common.assign", "Assign")}
							</Button>
						</ActionPanelFooter>
					</form>
				)}
			</ActionPanelContent>
		</ActionPanel>
	);
}
