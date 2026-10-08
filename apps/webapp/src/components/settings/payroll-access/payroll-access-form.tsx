"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import type {
	PayrollAccessEmployeeOption,
	PayrollAccessGrantData,
	PayrollAccessTeamOption,
	SavePayrollAccessInput,
} from "@/app/[locale]/(app)/settings/payroll-access/actions";
import {
	revokePayrollAccessGrantAction,
	savePayrollAccessAction,
} from "@/app/[locale]/(app)/settings/payroll-access/actions";
import { EmployeeSingleSelect } from "@/components/employee-select";
import {
	GrantList,
	GrantScopeFields,
	RevokeGrantDialog,
	toSelectableEmployee,
} from "@/components/settings/access-grants/grant-editor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface PayrollAccessFormProps {
	employees: PayrollAccessEmployeeOption[];
	/** Departed employees still on an active grant; only offered on the grant that names them. */
	departedEmployees: PayrollAccessEmployeeOption[];
	teams: PayrollAccessTeamOption[];
	initialGrants: PayrollAccessGrantData[];
}

const DEFAULT_FORM_VALUES: SavePayrollAccessInput = {
	payrollEmployeeId: "",
	scope: "specific",
	teamIds: [],
	employeeIds: [],
};
type TranslationParams = Record<string, string | number | boolean | null | undefined>;

export function PayrollAccessForm({
	employees,
	departedEmployees,
	teams,
	initialGrants,
}: PayrollAccessFormProps) {
	const { t } = useTranslate();
	const [isPending, setIsPending] = useState(false);
	const [editingGrantId, setEditingGrantId] = useState<string | null>(null);
	const [isEditorOpen, setIsEditorOpen] = useState(false);
	const [revokingGrant, setRevokingGrant] = useState<PayrollAccessGrantData | null>(null);
	const [isRevoking, setIsRevoking] = useState(false);
	const employeeOptions = employees.map((employee) =>
		toSelectableEmployee(employee, { isActive: true }),
	);
	const employeeNames = new Map(
		[...employees, ...departedEmployees].map((employee) => [employee.id, employee.name]),
	);

	const form = useForm({
		defaultValues: DEFAULT_FORM_VALUES,
		onSubmit: async ({ value }) => {
			setIsPending(true);
			try {
				const result = await savePayrollAccessAction(value);
				if (result.success) {
					toast.success(t("settings.payrollAccess.saved", "Payroll officer settings saved"));
					setIsEditorOpen(false);
					setEditingGrantId(null);
				} else {
					toast.error(
						result.error ||
							t("settings.payrollAccess.saveFailed", "Failed to save payroll officer settings"),
					);
				}
			} catch (error) {
				setIsPending(false);
				throw error;
			}
			setIsPending(false);
		},
	});
	const scope = useStore(form.store, (state) => state.values.scope);
	const payrollEmployeeId = useStore(form.store, (state) => state.values.payrollEmployeeId);
	const teamIds = useStore(form.store, (state) => state.values.teamIds);
	const employeeIds = useStore(form.store, (state) => state.values.employeeIds);
	const editingGrant = initialGrants.find((grant) => grant.id === editingGrantId);
	const activePayrollEmployeeIds = initialGrants.map((grant) => grant.payrollEmployeeId);
	const excludedPayrollEmployeeIds = activePayrollEmployeeIds.filter(
		(employeeId) => employeeId !== editingGrant?.payrollEmployeeId,
	);
	// A departed employee can stay on the grant that names them, but is never newly offered.
	const retainedDepartedEmployees = departedEmployees.filter((employee) =>
		editingGrant?.employeeIds.includes(employee.id),
	);
	const namedEmployeeOptions = [
		...employeeOptions,
		...retainedDepartedEmployees.map((employee) =>
			toSelectableEmployee(employee, { isActive: false }),
		),
	];
	const selectedDepartedNames = retainedDepartedEmployees
		.filter((employee) => employeeIds.includes(employee.id))
		.map((employee) => employee.name);
	const canSubmit =
		payrollEmployeeId.length > 0 &&
		(scope === "all" || teamIds.length > 0 || employeeIds.length > 0) &&
		!isPending;

	const openEditor = (grant: PayrollAccessGrantData | null) => {
		const values = grant ?? DEFAULT_FORM_VALUES;
		setEditingGrantId(grant?.id ?? null);
		form.setFieldValue("payrollEmployeeId", values.payrollEmployeeId);
		form.setFieldValue("scope", values.scope);
		form.setFieldValue("teamIds", values.teamIds);
		form.setFieldValue("employeeIds", values.employeeIds);
		setIsEditorOpen(true);
	};

	const revokeGrant = async () => {
		if (!revokingGrant) return;
		setIsRevoking(true);
		try {
			const result = await revokePayrollAccessGrantAction({ grantId: revokingGrant.id });
			if (result.success) {
				toast.success(t("settings.payrollAccess.revoked", "Payroll officer access revoked"));
				if (editingGrantId === revokingGrant.id) {
					setIsEditorOpen(false);
					setEditingGrantId(null);
				}
				setRevokingGrant(null);
			} else {
				toast.error(
					result.error ||
						t("settings.payrollAccess.revokeFailed", "Failed to revoke payroll officer access"),
				);
			}
		} finally {
			setIsRevoking(false);
		}
	};

	return (
		<div className="space-y-6">
			<GrantList
				rows={initialGrants.map((grant) => ({
					id: grant.id,
					title: employeeNames.get(grant.payrollEmployeeId) ?? grant.payrollEmployeeId,
					details: <p>{getScopeSummary({ grant, t })}</p>,
				}))}
				canAdd={employees.some((employee) => !activePayrollEmployeeIds.includes(employee.id))}
				onAdd={() => openEditor(null)}
				onEdit={(id) => openEditor(initialGrants.find((grant) => grant.id === id) ?? null)}
				onRevoke={(id) => setRevokingGrant(initialGrants.find((grant) => grant.id === id) ?? null)}
				copy={{
					add: t("settings.payrollAccess.add", "Add payroll officer"),
					empty: t("settings.payrollAccess.noGrants", "No payroll officers have been added yet."),
					edit: t("settings.payrollAccess.edit", "Edit"),
					revoke: t("settings.payrollAccess.revoke", "Revoke"),
				}}
			/>

			<RevokeGrantDialog
				open={revokingGrant !== null}
				pending={isRevoking}
				onConfirm={() => void revokeGrant()}
				onClose={() => setRevokingGrant(null)}
				copy={{
					title: t("settings.payrollAccess.revokeTitle", "Revoke payroll officer access?"),
					description: t(
						"settings.payrollAccess.revokeDescription",
						"{name} loses access to the payroll workspace immediately. Adding them again later creates a new grant.",
						{
							name: revokingGrant
								? (employeeNames.get(revokingGrant.payrollEmployeeId) ??
									revokingGrant.payrollEmployeeId)
								: "",
						},
					),
					cancel: t("common.cancel", "Cancel"),
					confirm: t("settings.payrollAccess.revokeConfirm", "Revoke access"),
				}}
			/>

			{isEditorOpen ? (
				// Client-side TanStack Form submit (docs/refs/forms.md); the settings page needs JS.
				// react-doctor-disable-next-line react-doctor/no-prevent-default
				<form
					className="space-y-6"
					onSubmit={(event) => {
						event.preventDefault();
						void form.handleSubmit();
					}}
				>
					<Card>
						<CardHeader>
							<CardTitle>
								{editingGrantId
									? t("settings.payrollAccess.editTitle", "Edit payroll officer")
									: t("settings.payrollAccess.addTitle", "Add payroll officer")}
							</CardTitle>
							<CardDescription>
								{t(
									"settings.payrollAccess.editorDescription",
									"Choose a payroll officer and define whether they can access everyone or a specific scope.",
								)}
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-6">
							<form.Field name="payrollEmployeeId">
								{(field) => (
									<EmployeeSingleSelect
										label={t("settings.payrollAccess.payrollEmployee", "Payroll officer")}
										placeholder={t(
											"settings.payrollAccess.selectPayrollEmployee",
											"Select employee",
										)}
										value={field.state.value || null}
										onChange={(value) => field.handleChange(value ?? "")}
										excludeIds={excludedPayrollEmployeeIds}
										employees={employeeOptions}
										disabled={isPending}
									/>
								)}
							</form.Field>

							<GrantScopeFields
								scope={scope}
								onScopeChange={(value) => {
									form.setFieldValue("scope", value);
									if (value === "all") {
										form.setFieldValue("teamIds", []);
										form.setFieldValue("employeeIds", []);
									}
								}}
								teamIds={teamIds}
								onTeamIdsChange={(value) => form.setFieldValue("teamIds", value)}
								employeeIds={employeeIds}
								onEmployeeIdsChange={(value) => form.setFieldValue("employeeIds", value)}
								teams={teams}
								employeeOptions={namedEmployeeOptions}
								disabled={isPending}
								testIdPrefix="payroll-access-team"
								copy={{
									scope: t("settings.payrollAccess.scope", "Access scope"),
									allScope: t("settings.payrollAccess.allScope", "All teams and employees"),
									specificScope: t(
										"settings.payrollAccess.specificScope",
										"Specific teams or employees",
									),
									allScopeDescription: t(
										"settings.payrollAccess.allScopeDescription",
										"Includes current and future employees in this organization.",
									),
									specificScopeDescription: t(
										"settings.payrollAccess.specificScopeDescription",
										"Limit payroll access to selected teams and individual employees.",
									),
									teams: t("settings.payrollAccess.teams", "Teams"),
									noTeams: t("settings.payrollAccess.noTeams", "No teams available"),
									employees: t("settings.payrollAccess.employees", "Employees"),
									selectEmployees: t("settings.payrollAccess.selectEmployees", "Select employees"),
									departedNotice:
										selectedDepartedNames.length > 0
											? t(
													"settings.payrollAccess.departedEmployeesKept",
													"{names} left the organization. They stay on this grant until you remove them.",
													{ names: selectedDepartedNames.join(", ") },
												)
											: null,
								}}
							/>

							<div className="flex flex-wrap gap-2">
								<Button type="submit" disabled={!canSubmit}>
									{isPending ? (
										<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
									) : null}
									{t("settings.payrollAccess.save", "Save payroll officer")}
								</Button>
								<Button
									type="button"
									variant="outline"
									onClick={() => setIsEditorOpen(false)}
									disabled={isPending}
								>
									{t("common.cancel", "Cancel")}
								</Button>
							</div>
						</CardContent>
					</Card>
				</form>
			) : null}
		</div>
	);
}

function getScopeSummary(input: {
	grant: PayrollAccessGrantData;
	t: (key: string, fallback: string, params?: TranslationParams) => string;
}): string {
	if (input.grant.scope === "all") {
		return input.t("settings.payrollAccess.allScope", "All teams and employees");
	}

	const teamCount = input.grant.teamIds.length;
	const employeeCount = input.grant.employeeIds.length;
	if (teamCount > 0 && employeeCount > 0) {
		return input.t(
			"settings.payrollAccess.scopeSummaryTeamsEmployees",
			"{teamCount} teams, {employeeCount} employees",
			{ teamCount, employeeCount },
		);
	}
	if (teamCount > 0) {
		return input.t("settings.payrollAccess.scopeSummaryTeams", "{count} teams", {
			count: teamCount,
		});
	}
	if (employeeCount > 0) {
		return input.t("settings.payrollAccess.scopeSummaryEmployees", "{count} employees", {
			count: employeeCount,
		});
	}
	return input.t("settings.payrollAccess.noScope", "No payroll scope assigned");
}
