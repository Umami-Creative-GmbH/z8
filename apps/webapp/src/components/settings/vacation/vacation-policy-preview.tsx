"use client";

import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { previewEmployeeVacationPolicy } from "@/app/[locale]/(app)/settings/vacation/assignment-actions";
import { EmployeeSingleSelect } from "@/components/employee-select";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	TFormControl,
	TFormItem,
	TFormLabel,
} from "@/components/ui/tanstack-form";
import type { VacationPolicyResolution } from "@/lib/absences/vacation-policy-history";
import { useVacationPolicyHistoryContext } from "./use-vacation-policy-history-context";

export function VacationPolicyPreview({
	organizationId,
}: {
	organizationId: string;
}) {
	const { t } = useTranslate();
	const context = useVacationPolicyHistoryContext(organizationId);
	const preview = useMutation({
		mutationFn: async (value: { employeeId: string; date: string }) => {
			const result = await previewEmployeeVacationPolicy(
				value.employeeId,
				value.date,
			);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});
	const form = useForm({
		defaultValues: { employeeId: "", date: "" },
		onSubmit: async ({ value }) => {
			if (value.employeeId && context.data)
				preview.mutate({
					employeeId: value.employeeId,
					date: value.date || context.data.today,
				});
		},
	});
	const result = preview.data;
	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">
					{t("settings.vacation.history.previewTitle", "Policy on a date")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.vacation.history.previewDescription",
						"See which policy and assignment source apply to an employee on a specific date.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<form
					className="grid items-end gap-4 sm:grid-cols-[1fr_1fr_auto]"
					onSubmit={(event) => {
						event.preventDefault();
						void form.handleSubmit();
					}}
				>
					<form.Field name="employeeId">
						{(field) => (
							<EmployeeSingleSelect
								// A date can lie in the past, when a former employee was still here (#1438).
								includeFormerEmployees
								label={t(
									"settings.vacation.history.previewEmployee",
									"Preview employee",
								)}
								value={field.state.value || null}
								onChange={(value) => {
									field.handleChange(value || "");
									preview.reset();
								}}
							/>
						)}
					</form.Field>
					<form.Field name="date">
						{(field) => (
							<TFormItem>
								<TFormLabel>
									{t("settings.vacation.history.previewDate", "Preview date")}
								</TFormLabel>
								<TFormControl>
									<Input
										type="date"
										name="previewDate"
										autoComplete="off"
										required
										value={field.state.value || context.data?.today || ""}
										onChange={(event) => {
											field.handleChange(event.target.value);
											preview.reset();
										}}
									/>
								</TFormControl>
							</TFormItem>
						)}
					</form.Field>
					<form.Subscribe selector={(state) => state.values.employeeId}>
						{(employeeId) => (
							<Button
								type="submit"
								variant="outline"
								disabled={!context.data || !employeeId || preview.isPending}
							>
								{preview.isPending
									? t(
											"settings.vacation.history.previewPending",
											"Loading preview…",
										)
									: t(
											"settings.vacation.history.previewAction",
											"Preview policy",
										)}
							</Button>
						)}
					</form.Subscribe>
				</form>
				{context.isError || preview.isError ? (
					<p role="alert" className="text-sm text-destructive">
						{t(
							"settings.vacation.history.previewError",
							"Could not load the policy preview. Please try again.",
						)}
					</p>
				) : null}
				{result ? <VacationPolicyPreviewResult result={result} /> : null}
			</CardContent>
		</Card>
	);
}

function VacationPolicyPreviewResult({
	result,
}: {
	result: VacationPolicyResolution;
}) {
	const { t } = useTranslate();
	const sourceLabel =
		result.status === "resolved"
			? {
					employee: t(
						"settings.vacation.history.sourceEmployee",
						"Employee assignment",
					),
					team: t("settings.vacation.history.sourceTeam", "Team assignment"),
					organization: t(
						"settings.vacation.history.sourceOrganization",
						"Organization assignment",
					),
					company_default: t(
						"settings.vacation.history.sourceCompanyDefault",
						"Company default",
					),
				}[result.source]
			: null;
	return (
		<div role="status" className="rounded-lg border bg-muted/30 p-4 text-sm">
			{result.status === "resolved" ? (
				<>
					<p className="font-medium">{result.policy.name}</p>
					<p className="text-muted-foreground">{sourceLabel}</p>
				</>
			) : null}
			{result.status === "missing" ? (
				<>
					<p className="font-medium">
						{t("settings.vacation.history.missing", "No policy for this date")}
					</p>
					<p className="text-muted-foreground">
						{t(
							"settings.vacation.history.missingHelp",
							"Add a dated assignment or a company default covering this date.",
						)}
					</p>
				</>
			) : null}
			{result.status === "conflict" ? (
				<>
					<p className="font-medium text-destructive">
						{t("settings.vacation.history.conflict", "Conflicting policies")}
					</p>
					<p className="text-muted-foreground">
						{result.reason === "incompatible_transition"
							? t(
									"settings.vacation.history.incompatibleTransition",
									"Calculation method or joiner/leaver proration changes must take effect on 1 January. Review this assignment.",
								)
							: t(
									"settings.vacation.history.conflictHelp",
									"Resolve the overlapping assignments before this date can use a policy.",
								)}
					</p>
				</>
			) : null}
			{result.status === "legacy" ? (
				<>
					<p className="font-medium">
						{t(
							"settings.vacation.history.legacy",
							"Before dated policy history",
						)}
					</p>
					<p className="text-muted-foreground">
						{t(
							"settings.vacation.history.legacyHelp",
							"Dated policy history for this organization starts after this date. Legacy policy rules apply.",
						)}
					</p>
					{result.policy ? <p>{result.policy.name}</p> : null}
				</>
			) : null}
		</div>
	);
}
