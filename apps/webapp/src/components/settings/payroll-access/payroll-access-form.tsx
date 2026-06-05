"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import type {
	PayrollAccessEmployeeOption,
	PayrollAccessGrantData,
	PayrollAccessTeamOption,
	SavePayrollAccessInput,
} from "@/app/[locale]/(app)/settings/payroll-access/actions";
import { savePayrollAccessAction } from "@/app/[locale]/(app)/settings/payroll-access/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

interface PayrollAccessFormProps {
	employees: PayrollAccessEmployeeOption[];
	teams: PayrollAccessTeamOption[];
	initialGrants: PayrollAccessGrantData[];
}

export function PayrollAccessForm({ employees, teams, initialGrants }: PayrollAccessFormProps) {
	const { t } = useTranslate();
	const [isPending, setIsPending] = useState(false);
	const firstGrant = initialGrants[0];

	const form = useForm({
		defaultValues: {
			payrollEmployeeId: firstGrant?.payrollEmployeeId ?? employees[0]?.id ?? "",
			teamIds: firstGrant?.teamIds ?? [],
			employeeIds: firstGrant?.employeeIds ?? [],
		} satisfies SavePayrollAccessInput,
		onSubmit: async ({ value }) => {
			setIsPending(true);
			try {
				const result = await savePayrollAccessAction(value);
				if (result.success) {
					toast.success(t("settings.payrollAccess.saved", "Payroll access saved"));
				} else {
					toast.error(
						result.error || t("settings.payrollAccess.saveFailed", "Failed to save payroll access"),
					);
				}
			} finally {
				setIsPending(false);
			}
		},
	});

	return (
		<form
			className="space-y-6"
			onSubmit={(event) => {
				event.preventDefault();
				form.handleSubmit();
			}}
		>
			<Card>
				<CardHeader>
					<CardTitle>{t("settings.payrollAccess.title", "Payroll access")}</CardTitle>
					<CardDescription>
						{t(
							"settings.payrollAccess.description",
							"Assign teams and individual employees that a payroll user can include in payroll workspaces.",
						)}
					</CardDescription>
					{initialGrants.length > 0 ? (
						<p className="text-sm text-muted-foreground">
							{t(
								"settings.payrollAccess.activeGrantCount",
								`${initialGrants.length} active payroll access grant${initialGrants.length === 1 ? "" : "s"}`,
							)}
						</p>
					) : null}
				</CardHeader>
				<CardContent className="space-y-6">
					<form.Field name="payrollEmployeeId">
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor="payroll-access-payroll-employee">
									{t("settings.payrollAccess.payrollEmployee", "Payroll employee")}
								</Label>
								<select
									id="payroll-access-payroll-employee"
									name="payrollEmployeeId"
									className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
									value={field.state.value}
									onChange={(event) => field.handleChange(event.target.value)}
									disabled={isPending || employees.length === 0}
								>
									{employees.map((employee) => (
										<option key={employee.id} value={employee.id}>
											{employee.name}
										</option>
									))}
								</select>
							</div>
						)}
					</form.Field>

					<form.Field name="teamIds">
						{(field) => (
							<fieldset className="space-y-3">
								<legend className="text-sm font-medium">
									{t("settings.payrollAccess.teams", "Teams")}
								</legend>
								{teams.length === 0 ? (
									<p className="text-sm text-muted-foreground">
										{t("settings.payrollAccess.noTeams", "No teams available")}
									</p>
								) : (
									<div className="grid gap-2 md:grid-cols-2">
										{teams.map((team) => (
											<label
												key={team.id}
												className="flex items-center gap-2 rounded-md border p-3 text-sm"
											>
												<input
													type="checkbox"
													checked={field.state.value.includes(team.id)}
													onChange={(event) =>
														field.handleChange(
															toggleId(field.state.value, team.id, event.target.checked),
														)
													}
													disabled={isPending}
												/>
												<span>{team.name}</span>
											</label>
										))}
									</div>
								)}
							</fieldset>
						)}
					</form.Field>

					<form.Field name="employeeIds">
						{(field) => (
							<fieldset className="space-y-3">
								<legend className="text-sm font-medium">
									{t("settings.payrollAccess.employees", "Employees")}
								</legend>
								<div className="grid gap-2 md:grid-cols-2">
									{employees.map((employee) => (
										<label
											key={employee.id}
											className="flex items-center gap-2 rounded-md border p-3 text-sm"
										>
											<input
												type="checkbox"
												checked={field.state.value.includes(employee.id)}
												onChange={(event) =>
													field.handleChange(
														toggleId(field.state.value, employee.id, event.target.checked),
													)
												}
												disabled={isPending}
											/>
											<span>{employee.name}</span>
										</label>
									))}
								</div>
							</fieldset>
						)}
					</form.Field>

					<Button type="submit" disabled={isPending || employees.length === 0}>
						{isPending ? (
							<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
						) : null}
						{t("settings.payrollAccess.save", "Save payroll access")}
					</Button>
				</CardContent>
			</Card>
		</form>
	);
}

function toggleId(values: string[], id: string, checked: boolean): string[] {
	if (checked) {
		return values.includes(id) ? values : [...values, id];
	}
	return values.filter((value) => value !== id);
}
