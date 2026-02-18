"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getAvailableEmployees } from "@/app/[locale]/(app)/settings/locations/actions";
import { assignSubareaEmployee } from "@/app/[locale]/(app)/settings/locations/assignment-actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { queryKeys } from "@/lib/query";

interface SubareaEmployeeDialogProps {
	organizationId: string;
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

export function SubareaEmployeeDialog({
	organizationId,
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
			}).then((response) => response, () => null);

			if (result?.success) {
				toast.success(t("settings.locations.employeeAssigned", "Employee assigned"));
				onSuccess();
				onOpenChange(false);
			} else {
				toast.error(
					result?.error ||
						t("settings.locations.employeeAssignFailed", "Failed to assign employee"),
				);
			}

			setIsSubmitting(false);
		},
	});

	// Reset form when dialog opens
	useEffect(() => {
		if (open) {
			form.reset();
		}
	}, [open, form]);

	// Fetch available employees
	const { data: employees, isLoading } = useQuery({
		queryKey: [...queryKeys.locations.subareas.employees(subareaId), "available"],
		queryFn: async () => {
			const result = await getAvailableEmployees(organizationId, undefined, subareaId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch employees");
			}
			return result.data;
		},
		enabled: open,
	});

	const getEmployeeName = (emp: NonNullable<typeof employees>[number]) => {
		if (emp.firstName || emp.lastName) {
			return `${emp.firstName || ""} ${emp.lastName || ""}`.trim();
		}
		return emp.user.name || emp.user.email;
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[450px]">
				<DialogHeader>
					<DialogTitle>
						{t("settings.locations.assignEmployeeToSubarea", "Assign Employee to Subarea")}
					</DialogTitle>
					<DialogDescription>
						{t(
							"settings.locations.assignEmployeeToSubareaDescription",
							"Assign an employee as a supervisor for {subareaName}",
							{ subareaName },
						)}
					</DialogDescription>
				</DialogHeader>

				{isLoading ? (
					<div className="space-y-4 py-4">
						<Skeleton className="h-10 w-full" />
						<Skeleton className="h-10 w-full" />
					</div>
				) : employees?.length === 0 ? (
					<div className="py-6 text-center text-muted-foreground">
						{t(
							"settings.locations.noAvailableEmployeesSubarea",
							"All employees are already assigned to this subarea",
						)}
					</div>
				) : (
					<form
						onSubmit={(e) => {
							e.preventDefault();
							form.handleSubmit();
						}}
					>
						<div className="space-y-4 py-4">
							{/* Employee Selection */}
							<form.Field name="employeeId">
								{(field) => (
									<div className="space-y-2">
										<Label>{t("settings.locations.employee", "Employee")}</Label>
										<Select value={field.state.value} onValueChange={field.handleChange}>
											<SelectTrigger>
												<SelectValue
													placeholder={t(
														"settings.locations.selectEmployeePlaceholder",
														"Select an employee",
													)}
												/>
											</SelectTrigger>
											<SelectContent>
												{employees?.map((emp) => (
													<SelectItem key={emp.id} value={emp.id}>
														<div className="flex flex-col">
															<span>{getEmployeeName(emp)}</span>
															<span className="text-xs text-muted-foreground">
																{emp.user.email}
															</span>
														</div>
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>
								)}
							</form.Field>

							{/* Primary Supervisor Checkbox */}
							<form.Field name="isPrimary">
								{(field) => (
									<div className="flex items-center space-x-2">
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
						</div>

						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => onOpenChange(false)}
								disabled={isSubmitting}
							>
								{t("common.cancel", "Cancel")}
							</Button>
							<Button type="submit" disabled={isSubmitting || !employees?.length}>
								{isSubmitting && <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />}
								{t("common.assign", "Assign")}
							</Button>
						</DialogFooter>
					</form>
				)}
			</DialogContent>
		</Dialog>
	);
}
