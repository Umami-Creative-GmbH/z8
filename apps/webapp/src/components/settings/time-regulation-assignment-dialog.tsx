"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useEffect } from "react";
import { toast } from "sonner";
import {
	createTimeRegulationAssignment,
	getTimeRegulations,
} from "@/app/[locale]/(app)/settings/time-regulations/actions";
import {
	getEmployeesForAssignment,
	getTeamsForAssignment,
} from "@/app/[locale]/(app)/settings/work-schedules/assignment-actions";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	fieldHasError,
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { queryKeys } from "@/lib/query";
import { timeRegulationAssignmentFormSchema } from "@/lib/time-regulations/validation";

interface TimeRegulationAssignmentDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
	assignmentType: "organization" | "team" | "employee";
	onSuccess: () => void;
}

function formatMinutesToHours(minutes: number | null): string {
	if (minutes === null) return "";
	const hours = Math.floor(minutes / 60);
	return `${hours}h`;
}

export function TimeRegulationAssignmentDialog({
	open,
	onOpenChange,
	organizationId,
	assignmentType,
	onSuccess,
}: TimeRegulationAssignmentDialogProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	const form = useForm({
		defaultValues: {
			regulationId: "",
			assignmentType: assignmentType as "organization" | "team" | "employee",
			teamId: null as string | null,
			employeeId: null as string | null,
			effectiveFrom: null as Date | null,
			effectiveUntil: null as Date | null,
			isActive: true,
		},
		validators: {
			onChange: ({ value }) => {
				const result = timeRegulationAssignmentFormSchema.safeParse(value);
				if (!result.success) {
					return result.error.issues[0]?.message || "Validation error";
				}
				return undefined;
			},
		},
		onSubmit: async ({ value }) => {
			createMutation.mutate(value);
		},
	});

	// Reset form when dialog opens
	useEffect(() => {
		if (open) {
			form.reset({
				regulationId: "",
				assignmentType,
				teamId: null,
				employeeId: null,
				effectiveFrom: null,
				effectiveUntil: null,
				isActive: true,
			});
		}
	}, [open, assignmentType, form]);

	// Fetch regulations
	const { data: regulations, isLoading: loadingRegulations } = useQuery({
		queryKey: queryKeys.timeRegulations.list(organizationId),
		queryFn: async () => {
			const result = await getTimeRegulations(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch regulations");
			}
			return result.data;
		},
		enabled: open,
		staleTime: 30 * 1000,
	});

	// Fetch teams (only for team assignments)
	const { data: teams, isLoading: loadingTeams } = useQuery({
		queryKey: queryKeys.teams.list(organizationId),
		queryFn: async () => {
			const result = await getTeamsForAssignment(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch teams");
			}
			return result.data;
		},
		enabled: open && assignmentType === "team",
		staleTime: 30 * 1000,
	});

	// Fetch employees (only for employee assignments)
	const { data: employees, isLoading: loadingEmployees } = useQuery({
		queryKey: queryKeys.employees.list(organizationId),
		queryFn: async () => {
			const result = await getEmployeesForAssignment(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch employees");
			}
			return result.data;
		},
		enabled: open && assignmentType === "employee",
		staleTime: 30 * 1000,
	});

	// Create assignment mutation
	const createMutation = useMutation({
		mutationFn: (data: typeof form.state.values) =>
			createTimeRegulationAssignment(organizationId, {
				regulationId: data.regulationId,
				assignmentType: data.assignmentType,
				teamId: assignmentType === "team" ? data.teamId : null,
				employeeId: assignmentType === "employee" ? data.employeeId : null,
			}),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.timeRegulations.assignmentCreated", "Regulation assigned"));
				queryClient.invalidateQueries({
					queryKey: queryKeys.timeRegulations.assignments(organizationId),
				});
				onSuccess();
				onOpenChange(false);
			} else {
				toast.error(
					result.error ||
						t("settings.timeRegulations.assignmentFailed", "Failed to assign regulation"),
				);
			}
		},
		onError: () => {
			toast.error(t("settings.timeRegulations.assignmentFailed", "Failed to assign regulation"));
		},
	});

	const getDialogTitle = () => {
		switch (assignmentType) {
			case "organization":
				return t("settings.timeRegulations.assignOrg", "Set Organization Default");
			case "team":
				return t("settings.timeRegulations.assignTeam", "Assign to Team");
			case "employee":
				return t("settings.timeRegulations.assignEmployee", "Assign to Employee");
		}
	};

	const getDialogDescription = () => {
		switch (assignmentType) {
			case "organization":
				return t(
					"settings.timeRegulations.assignOrgDescription",
					"Set the default time regulation for all employees in your organization.",
				);
			case "team":
				return t(
					"settings.timeRegulations.assignTeamDescription",
					"Override the organization default for a specific team.",
				);
			case "employee":
				return t(
					"settings.timeRegulations.assignEmployeeDescription",
					"Override the regulation for a specific employee.",
				);
		}
	};

	const formatRegulation = (regulation: NonNullable<typeof regulations>[number]) => {
		const parts: string[] = [regulation.name];
		if (regulation.maxDailyMinutes) {
			parts.push(`max ${formatMinutesToHours(regulation.maxDailyMinutes)}/day`);
		}
		return parts.join(" - ");
	};

	const isLoading =
		loadingRegulations ||
		(assignmentType === "team" && loadingTeams) ||
		(assignmentType === "employee" && loadingEmployees);

	const isPending = createMutation.isPending;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{getDialogTitle()}</DialogTitle>
					<DialogDescription>{getDialogDescription()}</DialogDescription>
				</DialogHeader>

				<form
					onSubmit={(e) => {
						e.preventDefault();
						e.stopPropagation();
						form.handleSubmit();
					}}
					className="space-y-4"
				>
					<form.Field name="regulationId">
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)}>
									{t("settings.timeRegulations.regulation", "Regulation")}
								</TFormLabel>
								<TFormControl hasError={fieldHasError(field)}>
									<Select value={field.state.value} onValueChange={field.handleChange}>
										<SelectTrigger>
											<SelectValue
												placeholder={t(
													"settings.timeRegulations.selectRegulation",
													"Select a regulation",
												)}
											/>
										</SelectTrigger>
										<SelectContent>
											{loadingRegulations ? (
												<SelectItem value="" disabled>
													{t("common.loading", "Loading...")}
												</SelectItem>
											) : regulations && regulations.length > 0 ? (
												regulations.map((regulation) => (
													<SelectItem key={regulation.id} value={regulation.id}>
														{formatRegulation(regulation)}
													</SelectItem>
												))
											) : (
												<SelectItem value="" disabled>
													{t(
														"settings.timeRegulations.noRegulationsAvailable",
														"No regulations available",
													)}
												</SelectItem>
											)}
										</SelectContent>
									</Select>
								</TFormControl>
								<TFormDescription>
									{t(
										"settings.timeRegulations.regulationDescription",
										"Choose the time regulation to assign",
									)}
								</TFormDescription>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>

					{/* Team Selection */}
					{assignmentType === "team" && (
						<form.Field name="teamId">
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)}>
										{t("settings.timeRegulations.team", "Team")}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<Select value={field.state.value || ""} onValueChange={field.handleChange}>
											<SelectTrigger>
												<SelectValue
													placeholder={t("settings.timeRegulations.selectTeam", "Select a team")}
												/>
											</SelectTrigger>
											<SelectContent>
												{loadingTeams ? (
													<SelectItem value="" disabled>
														{t("common.loading", "Loading...")}
													</SelectItem>
												) : teams && teams.length > 0 ? (
													teams.map((team) => (
														<SelectItem key={team.id} value={team.id}>
															{team.name}
														</SelectItem>
													))
												) : (
													<SelectItem value="" disabled>
														{t("settings.timeRegulations.noTeamsAvailable", "No teams available")}
													</SelectItem>
												)}
											</SelectContent>
										</Select>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>
					)}

					{/* Employee Selection */}
					{assignmentType === "employee" && (
						<form.Field name="employeeId">
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)}>
										{t("settings.timeRegulations.employee", "Employee")}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<Select value={field.state.value || ""} onValueChange={field.handleChange}>
											<SelectTrigger>
												<SelectValue
													placeholder={t(
														"settings.timeRegulations.selectEmployee",
														"Select an employee",
													)}
												/>
											</SelectTrigger>
											<SelectContent>
												{loadingEmployees ? (
													<SelectItem value="" disabled>
														{t("common.loading", "Loading...")}
													</SelectItem>
												) : employees && employees.length > 0 ? (
													employees.map((emp) => (
														<SelectItem key={emp.id} value={emp.id}>
															{`${emp.firstName || ""} ${emp.lastName || ""}`.trim() ||
																emp.employeeNumber ||
																t("common.unknown", "Unknown")}
														</SelectItem>
													))
												) : (
													<SelectItem value="" disabled>
														{t(
															"settings.timeRegulations.noEmployeesAvailable",
															"No employees available",
														)}
													</SelectItem>
												)}
											</SelectContent>
										</Select>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>
					)}

					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							{t("common.cancel", "Cancel")}
						</Button>
						<form.Subscribe selector={(state) => [state.isSubmitting, state.canSubmit]}>
							{([isSubmitting, canSubmit]) => (
								<Button
									type="submit"
									disabled={isPending || isSubmitting || isLoading || !canSubmit}
								>
									{(isPending || isSubmitting) && (
										<IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
									)}
									{t("settings.timeRegulations.assign", "Assign")}
								</Button>
							)}
						</form.Subscribe>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
