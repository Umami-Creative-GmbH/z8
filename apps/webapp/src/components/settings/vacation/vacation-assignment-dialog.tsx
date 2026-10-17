"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";
import { getTeamsForAssignment } from "@/app/[locale]/(app)/settings/holidays/preset-actions";
import {
	createVacationPolicyAssignment,
	getVacationPolicies,
} from "@/app/[locale]/(app)/settings/vacation/assignment-actions";
import { EmployeeSingleSelect } from "@/components/employee-select";
import { useAppLocale } from "@/components/providers/app-locale-provider";
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
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { queryKeys } from "@/lib/query/keys";
import { useVacationPolicyHistoryContext } from "./use-vacation-policy-history-context";

export type VacationAssignmentType = "organization" | "team" | "employee";
interface VacationAssignmentDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
	assignmentType: VacationAssignmentType;
	onSuccess: () => void;
	initialTargetId?: string;
}
interface PolicyOption {
	id: string;
	name: string;
	startDate: string;
	validUntil: string | null;
	isCompanyDefault: boolean;
	defaultAnnualDays: string;
	allowCarryover: boolean;
	isActive: boolean;
}
interface TeamOption {
	id: string;
	name: string;
}
interface AssignmentValues {
	policyId: string;
	teamId: string;
	employeeId: string;
	effectiveFrom: string;
	effectiveUntil: string;
	reviewedBackdate: boolean;
}
type Translate = ReturnType<typeof useTranslate>["t"];
type FieldErrors = Record<string, string>;
const EARLIEST_ASSIGNMENT_DATE = "2026-01-01";

function useAssignmentForm(
	type: VacationAssignmentType,
	target: string | undefined,
	submit: (value: AssignmentValues) => Promise<void>,
) {
	return useForm({
		defaultValues: {
			policyId: "",
			teamId: type === "team" ? (target ?? "") : "",
			employeeId: type === "employee" ? (target ?? "") : "",
			effectiveFrom: "",
			effectiveUntil: "",
			reviewedBackdate: false,
		},
		onSubmit: ({ value }) => submit(value),
	});
}
type AssignmentForm = ReturnType<typeof useAssignmentForm>;

function validateAssignment(
	value: AssignmentValues,
	type: VacationAssignmentType,
	today: string,
	t: Translate,
): FieldErrors {
	const errors: FieldErrors = {};
	if (!value.policyId)
		errors.policyId = t(
			"settings.vacation.history.selectPolicyError",
			"Please select a policy.",
		);
	if (type === "team" && !value.teamId)
		errors.teamId = t(
			"settings.vacation.history.selectTeamError",
			"Please select a team.",
		);
	if (type === "employee" && !value.employeeId)
		errors.employeeId = t(
			"settings.vacation.history.selectEmployeeError",
			"Please select an employee.",
		);
	try {
		const start = Temporal.PlainDate.from(value.effectiveFrom);
		if (Temporal.PlainDate.compare(start, EARLIEST_ASSIGNMENT_DATE) < 0)
			errors.effectiveFrom = t(
				"settings.vacation.history.baselineError",
				"Assignments must start on or after 1 January 2026.",
			);
		if (
			value.effectiveUntil &&
			Temporal.PlainDate.compare(value.effectiveUntil, start) <= 0
		)
			errors.effectiveUntil = t(
				"settings.vacation.history.endError",
				"The end date must be after the start date.",
			);
		if (Temporal.PlainDate.compare(start, today) < 0 && !value.reviewedBackdate)
			errors.reviewedBackdate = t(
				"settings.vacation.history.reviewError",
				"Review and confirm this backdated assignment.",
			);
	} catch {
		errors.effectiveFrom = t(
			"settings.vacation.history.dateError",
			"Enter a valid date.",
		);
	}
	return errors;
}
function assignmentCopy(type: VacationAssignmentType, t: Translate) {
	switch (type) {
		case "organization":
			return {
				title: t(
					"settings.vacation.history.assignOrganization",
					"Assign Organization Policy",
				),
				description: t(
					"settings.vacation.history.organizationDescription",
					"Set a dated organization policy. Employee and team assignments take precedence.",
				),
			};
		case "team":
			return {
				title: t(
					"settings.vacation.assignments.assignTeamPolicy",
					"Assign Team Policy",
				),
				description: t(
					"settings.vacation.history.teamDescription",
					"Set a dated policy for a team. Employee assignments take precedence.",
				),
			};
		case "employee":
			return {
				title: t(
					"settings.vacation.assignments.assignEmployeePolicy",
					"Assign Employee Policy",
				),
				description: t(
					"settings.vacation.history.employeeDescription",
					"Set a dated employee policy ahead of team and organization policies.",
				),
			};
	}
}
export function VacationAssignmentDialog({
	open,
	onOpenChange,
	organizationId,
	assignmentType,
	onSuccess,
	initialTargetId,
}: VacationAssignmentDialogProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const context = useVacationPolicyHistoryContext(organizationId, open);
	const [errors, setErrors] = useState<FieldErrors>({});
	const policies = useQuery({
		queryKey: queryKeys.vacationPolicies.list(organizationId),
		enabled: open,
		queryFn: async () => {
			const result = await getVacationPolicies(organizationId);
			if (!result.success) throw new Error(result.error);
			return (result.data as PolicyOption[]).filter(
				(policy) => policy.isActive,
			);
		},
	});
	const teams = useQuery({
		queryKey: queryKeys.teams.list(organizationId),
		enabled: open && assignmentType === "team",
		queryFn: async () => {
			const result = await getTeamsForAssignment(organizationId);
			if (!result.success) throw new Error(result.error);
			return result.data as TeamOption[];
		},
	});
	const create = useMutation({
		mutationFn: (value: AssignmentValues) =>
			createVacationPolicyAssignment({
				policyId: value.policyId,
				assignmentType,
				teamId: assignmentType === "team" ? value.teamId : undefined,
				employeeId:
					assignmentType === "employee" ? value.employeeId : undefined,
				effectiveFrom: value.effectiveFrom,
				effectiveUntil: value.effectiveUntil || undefined,
				reviewedBackdate: value.reviewedBackdate,
			}),
		onSuccess: (result) => {
			if (!result.success) {
				toast.error(
					result.error ||
						t(
							"settings.vacation.assignments.createFailed",
							"Failed to create policy assignment",
						),
				);
				return;
			}
			toast.success(
				t("settings.vacation.assignments.created", "Policy assignment created"),
			);
			void queryClient.invalidateQueries({
				queryKey: queryKeys.vacationPolicyAssignments.list(organizationId),
			});
			onSuccess();
			onOpenChange(false);
		},
		onError: () =>
			toast.error(
				t(
					"settings.vacation.assignments.createFailed",
					"Failed to create policy assignment",
				),
			),
	});
	const form = useAssignmentForm(
		assignmentType,
		initialTargetId,
		async (value) => {
			if (!context.data) return;
			const payload = {
				...value,
				effectiveFrom: value.effectiveFrom || context.data.today,
			};
			const nextErrors = validateAssignment(
				payload,
				assignmentType,
				context.data.today,
				t,
			);
			setErrors(nextErrors);
			if (Object.keys(nextErrors).length === 0) create.mutate(payload);
		},
	);
	const copy = assignmentCopy(assignmentType, t);
	const isLoading =
		policies.isLoading ||
		(assignmentType === "team" && teams.isLoading) ||
		context.isLoading;
	return (
		<ActionPanel
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) {
					form.reset();
					setErrors({});
				}
				onOpenChange(nextOpen);
			}}
		>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>{copy.title}</ActionPanelTitle>
					<ActionPanelDescription>{copy.description}</ActionPanelDescription>
				</ActionPanelHeader>
				{isLoading ? (
					<ActionPanelBody className="space-y-4">
						<Skeleton className="h-10 w-full" />
						<Skeleton className="h-10 w-full" />
					</ActionPanelBody>
				) : (
					<form
						className="flex min-h-0 flex-1 flex-col"
						onSubmit={(event) => {
							event.preventDefault();
							void form.handleSubmit();
						}}
					>
						<ActionPanelBody className="space-y-4">
							<VacationPolicyField
								form={form}
								errors={errors}
								policies={policies.data ?? []}
							/>
							<VacationTargetField
								form={form}
								errors={errors}
								type={assignmentType}
								teams={teams.data ?? []}
							/>
							<VacationAssignmentDates
								form={form}
								errors={errors}
								today={context.data?.today ?? ""}
							/>
							{context.isError || policies.isError || teams.isError ? (
								<p role="alert" className="text-sm text-destructive">
									{t(
										"settings.vacation.history.contextError",
										"Could not load assignment options. Reopen this panel to try again.",
									)}
								</p>
							) : null}
						</ActionPanelBody>
						<ActionPanelFooter>
							<Button
								type="button"
								variant="outline"
								disabled={create.isPending}
								onClick={() => onOpenChange(false)}
							>
								{t("common.cancel", "Cancel")}
							</Button>
							<Button
								type="submit"
								disabled={
									create.isPending || !policies.data?.length || !context.data
								}
							>
								{create.isPending ? (
									<IconLoader2
										aria-hidden="true"
										className="mr-2 size-4 animate-spin"
									/>
								) : null}
								{t("common.assign", "Assign")}
							</Button>
						</ActionPanelFooter>
					</form>
				)}
			</ActionPanelContent>
		</ActionPanel>
	);
}
function VacationPolicyField({
	form,
	errors,
	policies,
}: {
	form: AssignmentForm;
	errors: FieldErrors;
	policies: PolicyOption[];
}) {
	const { t } = useTranslate();
	const locale = useAppLocale();
	return (
		<form.Field name="policyId">
			{(field) => (
				<TFormItem>
					<TFormLabel>
						{t("settings.vacation.assignments.policy", "Vacation Policy")}
					</TFormLabel>
					<Select value={field.state.value} onValueChange={field.handleChange}>
						<TFormControl hasError={!!errors.policyId}>
							<SelectTrigger className="w-full">
								<SelectValue
									placeholder={t(
										"settings.vacation.assignments.selectPolicy",
										"Select a policy",
									)}
								/>
							</SelectTrigger>
						</TFormControl>
						<SelectContent>
							{policies.map((policy) => (
								<SelectItem key={policy.id} value={policy.id}>
									<span>
										{policy.name} · {policy.defaultAnnualDays}{" "}
										{t("settings.vacation.days", "days")} ·{" "}
										{Temporal.PlainDate.from(policy.startDate).toLocaleString(
											locale,
											{ month: "short", year: "numeric" },
										)}
									</span>
									{policy.isCompanyDefault ? (
										<span className="rounded bg-primary px-1 text-xs text-primary-foreground">
											{t("settings.vacation.default", "Default")}
										</span>
									) : null}
									{policy.allowCarryover ? (
										<span className="rounded bg-secondary px-1 text-xs">
											{t("settings.vacation.carryover", "Carryover")}
										</span>
									) : null}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<TFormDescription>
						{policies.length
							? t(
									"settings.vacation.assignments.policyDescription",
									"The vacation policy to assign",
								)
							: t(
									"settings.vacation.assignments.noPolicies",
									"No vacation policies available. Create one first.",
								)}
					</TFormDescription>
					<TFormMessage>{errors.policyId}</TFormMessage>
				</TFormItem>
			)}
		</form.Field>
	);
}
function VacationTargetField({
	form,
	errors,
	type,
	teams,
}: {
	form: AssignmentForm;
	errors: FieldErrors;
	type: VacationAssignmentType;
	teams: TeamOption[];
}) {
	const { t } = useTranslate();
	if (type === "organization") return null;
	if (type === "employee")
		return (
			<form.Field name="employeeId">
				{(field) => (
					<EmployeeSingleSelect
						value={field.state.value || null}
						onChange={(value) => field.handleChange(value || "")}
						label={t("settings.vacation.assignments.employee", "Employee")}
						placeholder={t(
							"settings.vacation.assignments.selectEmployee",
							"Select an employee",
						)}
						error={errors.employeeId}
					/>
				)}
			</form.Field>
		);
	return (
		<form.Field name="teamId">
			{(field) => (
				<TFormItem>
					<TFormLabel>
						{t("settings.vacation.assignments.team", "Team")}
					</TFormLabel>
					<Select value={field.state.value} onValueChange={field.handleChange}>
						<TFormControl hasError={!!errors.teamId}>
							<SelectTrigger className="w-full">
								<SelectValue
									placeholder={t(
										"settings.vacation.assignments.selectTeam",
										"Select a team",
									)}
								/>
							</SelectTrigger>
						</TFormControl>
						<SelectContent>
							{teams.map((team) => (
								<SelectItem key={team.id} value={team.id}>
									{team.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<TFormMessage>{errors.teamId}</TFormMessage>
				</TFormItem>
			)}
		</form.Field>
	);
}
function VacationAssignmentDates({
	form,
	errors,
	today,
}: {
	form: AssignmentForm;
	errors: FieldErrors;
	today: string;
}) {
	const { t } = useTranslate();
	const start =
		useStore(form.store, (state) => state.values.effectiveFrom) || today;
	const isBackdated =
		!!start && !!today && Temporal.PlainDate.compare(start, today) < 0;
	return (
		<>
			<p className="text-sm text-muted-foreground">
				{t(
					"settings.vacation.history.replacementHelp",
					"A replacement closes the previous assignment on its start date and preserves earlier history.",
				)}
			</p>
			<div className="grid gap-4 sm:grid-cols-2">
				<form.Field name="effectiveFrom">
					{(field) => (
						<TFormItem>
							<TFormLabel>
								{t("settings.vacation.history.effectiveFrom", "Effective from")}
							</TFormLabel>
							<TFormControl hasError={!!errors.effectiveFrom}>
								<Input
									type="date"
									name={field.name}
									autoComplete="off"
									min={EARLIEST_ASSIGNMENT_DATE}
									required
									value={field.state.value || today}
									onChange={(event) => {
										field.handleChange(event.target.value);
										form.setFieldValue("reviewedBackdate", false);
									}}
									onBlur={field.handleBlur}
								/>
							</TFormControl>
							<TFormMessage>{errors.effectiveFrom}</TFormMessage>
						</TFormItem>
					)}
				</form.Field>
				<form.Field name="effectiveUntil">
					{(field) => (
						<TFormItem>
							<TFormLabel>
								{t(
									"settings.vacation.history.effectiveUntil",
									"End date (optional)",
								)}
							</TFormLabel>
							<TFormControl hasError={!!errors.effectiveUntil}>
								<Input
									type="date"
									name={field.name}
									autoComplete="off"
									min={
										start
											? Temporal.PlainDate.from(start)
													.add({ days: 1 })
													.toString()
											: undefined
									}
									value={field.state.value}
									onChange={(event) => field.handleChange(event.target.value)}
									onBlur={field.handleBlur}
								/>
							</TFormControl>
							<TFormDescription>
								{t(
									"settings.vacation.history.endExclusive",
									"The assignment no longer applies on this date.",
								)}
							</TFormDescription>
							<TFormMessage>{errors.effectiveUntil}</TFormMessage>
						</TFormItem>
					)}
				</form.Field>
			</div>
			{isBackdated ? (
				<form.Field name="reviewedBackdate">
					{(field) => (
						<TFormItem>
							<div className="flex items-start gap-2">
								<TFormControl hasError={!!errors.reviewedBackdate}>
									<Checkbox
										checked={field.state.value}
										onCheckedChange={(checked) =>
											field.handleChange(checked === true)
										}
									/>
								</TFormControl>
								<TFormLabel>
									{t(
										"settings.vacation.history.reviewLabel",
										"I reviewed the dates and impact of this backdated assignment.",
									)}
								</TFormLabel>
							</div>
							<TFormMessage>{errors.reviewedBackdate}</TFormMessage>
						</TFormItem>
					)}
				</form.Field>
			) : null}
		</>
	);
}
