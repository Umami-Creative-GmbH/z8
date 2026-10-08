"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	type ExpenseOfficerAdminData,
	type ExpenseOfficerGrantData,
	getExpenseOfficerAdminData,
	revokeExpenseOfficerGrantAction,
	type SaveExpenseOfficerGrantInput,
	saveExpenseOfficerGrantAction,
} from "@/app/[locale]/(app)/settings/travel-expenses/expense-officer-actions";
import { EmployeeSingleSelect } from "@/components/employee-select";
import {
	GrantList,
	GrantScopeFields,
	RevokeGrantDialog,
	toSelectableEmployee,
} from "@/components/settings/access-grants/grant-editor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { queryKeys } from "@/lib/query/keys";

const queryKey = queryKeys.travelExpenses.expenseOfficers();

const DEFAULT_VALUES: SaveExpenseOfficerGrantInput = {
	officerEmployeeId: "",
	scope: "specific",
	teamIds: [],
	employeeIds: [],
	canExport: false,
	canRecordReimbursements: false,
};

type Translate = ReturnType<typeof useTranslate>["t"];

function scopeSummary(grant: ExpenseOfficerGrantData, t: Translate): string {
	if (grant.scope === "all") {
		return t("settings.travelExpenses.officers.allScope", "All employees");
	}
	return t(
		"settings.travelExpenses.officers.scopeSummary",
		"{teamCount, plural, one {# team} other {# teams}}, {employeeCount, plural, one {# employee} other {# employees}}",
		{ teamCount: grant.teamIds.length, employeeCount: grant.employeeIds.length },
	);
}

function capabilitySummary(grant: ExpenseOfficerGrantData, t: Translate): string {
	if (grant.canExport && grant.canRecordReimbursements) {
		return t(
			"settings.travelExpenses.officers.capabilitiesBoth",
			"Reads, exports and records reimbursements",
		);
	}
	if (grant.canExport) {
		return t("settings.travelExpenses.officers.capabilitiesExport", "Reads and exports");
	}
	if (grant.canRecordReimbursements) {
		return t(
			"settings.travelExpenses.officers.capabilitiesReimburse",
			"Reads and records reimbursements",
		);
	}
	return t("settings.travelExpenses.officers.capabilitiesRead", "Read only");
}

function ExpenseOfficerEditor({ data }: { data: ExpenseOfficerAdminData }) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [editingGrantId, setEditingGrantId] = useState<string | null>(null);
	const [isEditorOpen, setIsEditorOpen] = useState(false);
	const [revokingGrant, setRevokingGrant] = useState<ExpenseOfficerGrantData | null>(null);
	const [isRevoking, setIsRevoking] = useState(false);
	const people = [...data.employees, ...data.departedEmployees];
	const nameOf = (employeeId: string) =>
		people.find((person) => person.id === employeeId)?.name ?? employeeId;
	const officerOptions = data.employees.map((person) =>
		toSelectableEmployee(person, { isActive: true }),
	);
	// Departed employees can be named: their last approved reports may still be owed.
	const namedOptions = [
		...officerOptions,
		...data.departedEmployees.map((person) => toSelectableEmployee(person, { isActive: false })),
	];

	const form = useForm({
		defaultValues: DEFAULT_VALUES,
		onSubmit: async ({ value }) => {
			const result = await saveExpenseOfficerGrantAction(value);
			if (!result.success) {
				toast.error(
					result.error ||
						t("settings.travelExpenses.officers.saveFailed", "Failed to save the expense officer"),
				);
				return;
			}
			await queryClient.invalidateQueries({ queryKey });
			toast.success(t("settings.travelExpenses.officers.saved", "Expense officer saved"));
			setIsEditorOpen(false);
			setEditingGrantId(null);
		},
	});
	const values = useStore(form.store, (state) => state.values);
	const isSubmitting = useStore(form.store, (state) => state.isSubmitting);
	const editingGrant = data.grants.find((grant) => grant.id === editingGrantId);
	const officerIds = data.grants.map((grant) => grant.officerEmployeeId);
	const selectedDepartedNames = data.departedEmployees
		.filter((person) => values.employeeIds.includes(person.id))
		.map((person) => person.name);
	const canSubmit =
		values.officerEmployeeId.length > 0 &&
		(values.scope === "all" || values.teamIds.length > 0 || values.employeeIds.length > 0) &&
		!isSubmitting;

	const openEditor = (grant: ExpenseOfficerGrantData | null) => {
		const next = grant ?? DEFAULT_VALUES;
		setEditingGrantId(grant?.id ?? null);
		form.setFieldValue("officerEmployeeId", next.officerEmployeeId);
		form.setFieldValue("scope", next.scope);
		form.setFieldValue("teamIds", next.teamIds);
		form.setFieldValue("employeeIds", next.employeeIds);
		form.setFieldValue("canExport", next.canExport);
		form.setFieldValue("canRecordReimbursements", next.canRecordReimbursements);
		setIsEditorOpen(true);
	};

	const revoke = async () => {
		if (!revokingGrant) return;
		setIsRevoking(true);
		try {
			const result = await revokeExpenseOfficerGrantAction({ grantId: revokingGrant.id });
			if (!result.success) {
				toast.error(
					result.error ||
						t(
							"settings.travelExpenses.officers.revokeFailed",
							"Failed to revoke the expense officer",
						),
				);
				return;
			}
			await queryClient.invalidateQueries({ queryKey });
			toast.success(t("settings.travelExpenses.officers.revoked", "Expense officer revoked"));
			if (editingGrantId === revokingGrant.id) {
				setIsEditorOpen(false);
				setEditingGrantId(null);
			}
			setRevokingGrant(null);
		} finally {
			setIsRevoking(false);
		}
	};

	return (
		<div className="space-y-6">
			<GrantList
				rows={data.grants.map((grant) => ({
					id: grant.id,
					title: nameOf(grant.officerEmployeeId),
					details: (
						<>
							<p>{scopeSummary(grant, t)}</p>
							<p>{capabilitySummary(grant, t)}</p>
						</>
					),
				}))}
				canAdd={data.employees.some((person) => !officerIds.includes(person.id))}
				onAdd={() => openEditor(null)}
				onEdit={(id) => openEditor(data.grants.find((grant) => grant.id === id) ?? null)}
				onRevoke={(id) => setRevokingGrant(data.grants.find((grant) => grant.id === id) ?? null)}
				copy={{
					add: t("settings.travelExpenses.officers.add", "Add expense officer"),
					empty: t(
						"settings.travelExpenses.officers.empty",
						"No expense officers yet. Owners and admins handle approved expense reports.",
					),
					edit: t("settings.travelExpenses.officers.edit", "Edit"),
					revoke: t("settings.travelExpenses.officers.revoke", "Revoke"),
				}}
			/>

			<RevokeGrantDialog
				open={revokingGrant !== null}
				pending={isRevoking}
				onConfirm={() => void revoke()}
				onClose={() => setRevokingGrant(null)}
				copy={{
					title: t("settings.travelExpenses.officers.revokeTitle", "Revoke expense officer?"),
					description: t(
						"settings.travelExpenses.officers.revokeDescription",
						"{name} loses access to approved expense reports immediately. Adding them again later creates a new grant.",
						{ name: revokingGrant ? nameOf(revokingGrant.officerEmployeeId) : "" },
					),
					cancel: t("common.cancel", "Cancel"),
					confirm: t("settings.travelExpenses.officers.revokeConfirm", "Revoke access"),
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
								{editingGrant
									? t("settings.travelExpenses.officers.editTitle", "Edit expense officer")
									: t("settings.travelExpenses.officers.addTitle", "Add expense officer")}
							</CardTitle>
							<CardDescription>
								{t(
									"settings.travelExpenses.officers.editorDescription",
									"Choose whose approved expense reports the officer handles and what they may do with them. Officers always see the reports in their scope.",
								)}
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-6">
							<form.Field name="officerEmployeeId">
								{(field) => (
									<EmployeeSingleSelect
										label={t("settings.travelExpenses.officers.officer", "Expense officer")}
										placeholder={t(
											"settings.travelExpenses.officers.selectOfficer",
											"Select employee",
										)}
										value={field.state.value || null}
										onChange={(value) => field.handleChange(value ?? "")}
										excludeIds={officerIds.filter((id) => id !== editingGrant?.officerEmployeeId)}
										employees={officerOptions}
										disabled={isSubmitting || Boolean(editingGrant)}
									/>
								)}
							</form.Field>

							<GrantScopeFields
								scope={values.scope}
								onScopeChange={(scope) => {
									form.setFieldValue("scope", scope);
									if (scope === "all") {
										form.setFieldValue("teamIds", []);
										form.setFieldValue("employeeIds", []);
									}
								}}
								teamIds={values.teamIds}
								onTeamIdsChange={(teamIds) => form.setFieldValue("teamIds", teamIds)}
								employeeIds={values.employeeIds}
								onEmployeeIdsChange={(employeeIds) =>
									form.setFieldValue("employeeIds", employeeIds)
								}
								teams={data.teams}
								employeeOptions={namedOptions}
								disabled={isSubmitting}
								testIdPrefix="expense-officer-team"
								copy={{
									scope: t("settings.travelExpenses.officers.scope", "Officer scope"),
									allScope: t("settings.travelExpenses.officers.allScope", "All employees"),
									specificScope: t(
										"settings.travelExpenses.officers.specificScope",
										"Specific teams or employees",
									),
									allScopeDescription: t(
										"settings.travelExpenses.officers.allScopeDescription",
										"Every approved expense report of this organization.",
									),
									specificScopeDescription: t(
										"settings.travelExpenses.officers.specificScopeDescription",
										"Reports of the named employees, and reports whose employee belonged to one of the teams when the report was approved. A later team change does not move a report.",
									),
									teams: t("settings.travelExpenses.officers.teams", "Teams"),
									noTeams: t("settings.travelExpenses.officers.noTeams", "No teams available"),
									employees: t("settings.travelExpenses.officers.employees", "Employees"),
									selectEmployees: t(
										"settings.travelExpenses.officers.selectEmployees",
										"Select employees",
									),
									departedNotice:
										selectedDepartedNames.length > 0
											? t(
													"settings.travelExpenses.officers.departedNamed",
													"{names} left the organization. Their approved reports stay with this officer.",
													{ names: selectedDepartedNames.join(", ") },
												)
											: null,
								}}
							/>

							<fieldset className="space-y-3">
								<legend className="text-sm font-medium">
									{t("settings.travelExpenses.officers.capabilities", "Capabilities")}
								</legend>
								<form.Field name="canExport">
									{(field) => (
										<div className="flex items-start gap-2">
											<Checkbox
												id="expense-officer-can-export"
												checked={field.state.value}
												onCheckedChange={(checked) => field.handleChange(checked === true)}
												disabled={isSubmitting}
											/>
											<Label htmlFor="expense-officer-can-export" className="font-normal">
												{t("settings.travelExpenses.officers.canExport", "Can export")}
											</Label>
										</div>
									)}
								</form.Field>
								<form.Field name="canRecordReimbursements">
									{(field) => (
										<div className="flex items-start gap-2">
											<Checkbox
												id="expense-officer-can-reimburse"
												checked={field.state.value}
												onCheckedChange={(checked) => field.handleChange(checked === true)}
												disabled={isSubmitting}
											/>
											<Label htmlFor="expense-officer-can-reimburse" className="font-normal">
												{t(
													"settings.travelExpenses.officers.canRecordReimbursements",
													"Can record reimbursements",
												)}
											</Label>
										</div>
									)}
								</form.Field>
								<p className="text-muted-foreground text-sm">
									{t(
										"settings.travelExpenses.officers.capabilitiesDescription",
										"Without either, the officer can read the reports in their scope, for example as an auditor. Recording reimbursements includes recoveries. Nobody records money for their own expenses.",
									)}
								</p>
							</fieldset>

							<div className="flex flex-wrap gap-2">
								<Button type="submit" disabled={!canSubmit}>
									{isSubmitting ? (
										<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
									) : null}
									{t("settings.travelExpenses.officers.save", "Save expense officer")}
								</Button>
								<Button
									type="button"
									variant="outline"
									onClick={() => setIsEditorOpen(false)}
									disabled={isSubmitting}
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

/**
 * Expense officers (#747): finance access to approved expense reports for
 * people who are not owners or admins, scoped like payroll access.
 */
export function ExpenseOfficerSettingsCard() {
	const { t } = useTranslate();
	const { data, isLoading, isError, refetch } = useQuery({
		queryKey,
		queryFn: async () => {
			const result = await getExpenseOfficerAdminData();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});
	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("settings.travelExpenses.officers.title", "Expense officers")}</CardTitle>
				<CardDescription>
					{t(
						"settings.travelExpenses.officers.intro",
						"Expense officers export approved expense reports for bookkeeping and record reimbursements, for all employees or for named teams and employees. Owners and admins always have this access. Approving reports never grants it.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{isLoading && <Skeleton aria-hidden="true" className="h-32 w-full" />}
				{isError && (
					<div className="space-y-2">
						<p className="text-sm text-destructive" role="alert">
							{t(
								"settings.travelExpenses.officers.loadFailed",
								"The expense officers could not be loaded.",
							)}
						</p>
						<Button type="button" variant="outline" onClick={() => void refetch()}>
							{t("common.retry", "Retry")}
						</Button>
					</div>
				)}
				{data && <ExpenseOfficerEditor data={data} />}
			</CardContent>
		</Card>
	);
}
