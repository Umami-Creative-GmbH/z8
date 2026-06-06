"use client";

import { IconEdit, IconLoader2, IconPlus } from "@tabler/icons-react";
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
import { savePayrollAccessAction } from "@/app/[locale]/(app)/settings/payroll-access/actions";
import { EmployeeMultiSelect, EmployeeSingleSelect, type SelectableEmployee } from "@/components/employee-select";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

interface PayrollAccessFormProps {
	employees: PayrollAccessEmployeeOption[];
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

export function PayrollAccessForm({ employees, teams, initialGrants }: PayrollAccessFormProps) {
	const { t } = useTranslate();
	const [isPending, setIsPending] = useState(false);
	const [editingGrantId, setEditingGrantId] = useState<string | null>(null);
	const [isEditorOpen, setIsEditorOpen] = useState(false);
	const employeeOptions = employees.map(toSelectableEmployee);
	const employeeById = new Map(employees.map((employee) => [employee.id, employee]));

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
	const activePayrollEmployeeIds = initialGrants.map((grant) => grant.payrollEmployeeId);
	const excludedPayrollEmployeeIds = activePayrollEmployeeIds.filter((employeeId) => {
		const editingGrant = initialGrants.find((grant) => grant.id === editingGrantId);
		return employeeId !== editingGrant?.payrollEmployeeId;
	});
	const canSubmit =
		payrollEmployeeId.length > 0 &&
		(scope === "all" || teamIds.length > 0 || employeeIds.length > 0) &&
		!isPending;

	const openAddEditor = () => {
		setEditingGrantId(null);
		form.setFieldValue("payrollEmployeeId", DEFAULT_FORM_VALUES.payrollEmployeeId);
		form.setFieldValue("scope", DEFAULT_FORM_VALUES.scope);
		form.setFieldValue("teamIds", DEFAULT_FORM_VALUES.teamIds);
		form.setFieldValue("employeeIds", DEFAULT_FORM_VALUES.employeeIds);
		setIsEditorOpen(true);
	};

	const openEditEditor = (grant: PayrollAccessGrantData) => {
		setEditingGrantId(grant.id);
		form.setFieldValue("payrollEmployeeId", grant.payrollEmployeeId);
		form.setFieldValue("scope", grant.scope);
		form.setFieldValue("teamIds", grant.teamIds);
		form.setFieldValue("employeeIds", grant.employeeIds);
		setIsEditorOpen(true);
	};

	return (
		<div className="space-y-6">
			<Card>
				<CardHeader className="flex justify-end">
					<Button type="button" onClick={openAddEditor} disabled={employees.length === initialGrants.length}>
						<IconPlus className="size-4" aria-hidden="true" />
						{t("settings.payrollAccess.add", "Add payroll officer")}
					</Button>
				</CardHeader>
				<CardContent>
					{initialGrants.length === 0 ? (
						<p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm">
							{t("settings.payrollAccess.noGrants", "No payroll officers have been added yet.")}
						</p>
					) : (
						<div className="divide-y rounded-lg border">
							{initialGrants.map((grant) => (
								<div
									key={grant.id}
									className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
								>
									<div className="space-y-1">
										<p className="font-medium text-sm">
											{employeeById.get(grant.payrollEmployeeId)?.name ?? grant.payrollEmployeeId}
										</p>
										<p className="text-muted-foreground text-sm">
											{getScopeSummary({ grant, t })}
										</p>
									</div>
									<Button type="button" variant="outline" size="sm" onClick={() => openEditEditor(grant)}>
										<IconEdit className="size-4" aria-hidden="true" />
										{t("settings.payrollAccess.edit", "Edit")}
									</Button>
								</div>
							))}
						</div>
					)}
				</CardContent>
			</Card>

			{isEditorOpen ? (
				<form
					className="space-y-6"
					onSubmit={(event) => {
						event.preventDefault();
						form.handleSubmit();
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
										placeholder={t("settings.payrollAccess.selectPayrollEmployee", "Select employee")}
										value={field.state.value || null}
										onChange={(value) => field.handleChange(value ?? "")}
										excludeIds={excludedPayrollEmployeeIds}
										employees={employeeOptions}
										disabled={isPending}
									/>
								)}
							</form.Field>

							<form.Field name="scope">
								{(field) => (
									<fieldset className="space-y-3">
										<legend className="text-sm font-medium">
											{t("settings.payrollAccess.scope", "Access scope")}
										</legend>
										<ToggleGroup
											type="single"
											variant="outline"
											value={field.state.value}
											onValueChange={(value) => {
												if (value === "all") {
													field.handleChange("all");
													form.setFieldValue("teamIds", []);
													form.setFieldValue("employeeIds", []);
												} else if (value === "specific") {
													field.handleChange("specific");
												}
											}}
											disabled={isPending}
											className="w-full"
										>
											<ToggleGroupItem
												value="all"
												aria-label={t("settings.payrollAccess.allScope", "All teams and employees")}
											>
												{t("settings.payrollAccess.allScope", "All teams and employees")}
											</ToggleGroupItem>
											<ToggleGroupItem
												value="specific"
												aria-label={t("settings.payrollAccess.specificScope", "Specific teams or employees")}
											>
												{t("settings.payrollAccess.specificScope", "Specific teams or employees")}
											</ToggleGroupItem>
										</ToggleGroup>
										<p className="text-muted-foreground text-sm">
											{field.state.value === "all"
												? t(
														"settings.payrollAccess.allScopeDescription",
														"Includes current and future employees in this organization.",
													)
												: t(
														"settings.payrollAccess.specificScopeDescription",
														"Limit payroll access to selected teams and individual employees.",
													)}
										</p>
									</fieldset>
								)}
							</form.Field>

							{scope === "specific" ? (
								<div className="grid gap-6 lg:grid-cols-2">
									<form.Field name="teamIds">
										{(field) => (
											<fieldset className="space-y-3">
												<legend className="text-sm font-medium">
													{t("settings.payrollAccess.teams", "Teams")}
												</legend>
												{teams.length === 0 ? (
													<p className="text-muted-foreground text-sm">
														{t("settings.payrollAccess.noTeams", "No teams available")}
													</p>
												) : (
													<div className="grid gap-2 sm:grid-cols-2" data-testid="payroll-access-team-grid">
														{teams.map((team) => {
															const isSelected = field.state.value.includes(team.id);

															return (
																<button
																	key={team.id}
																	type="button"
																	role="switch"
																	aria-checked={isSelected}
																	aria-label={team.name}
																	data-testid={`payroll-access-team-${team.id}`}
																	onClick={() => {
																		field.handleChange(toggleId(field.state.value, team.id, !isSelected));
																	}}
																	disabled={isPending}
																	className={`flex items-center justify-between gap-4 rounded-md border p-3 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
																		isSelected ? "border-primary/60 bg-primary/5" : "hover:bg-accent/50"
																	}`}
																>
																	<span>{team.name}</span>
																	<span
																		aria-hidden="true"
																		className={`inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-colors ${
																			isSelected ? "bg-primary" : "bg-input dark:bg-input/80"
																		}`}
																	>
																		<span
																			className={`block size-4 rounded-full bg-background ring-0 transition-transform dark:bg-foreground ${
																				isSelected ? "translate-x-[calc(100%-2px)] dark:bg-primary-foreground" : "translate-x-0"
																			}`}
																		/>
																	</span>
																</button>
															);
														})}
													</div>
												)}
											</fieldset>
										)}
									</form.Field>

									<form.Field name="employeeIds">
										{(field) => (
											<EmployeeMultiSelect
												label={t("settings.payrollAccess.employees", "Employees")}
												placeholder={t("settings.payrollAccess.selectEmployees", "Select employees")}
												value={field.state.value}
												onChange={field.handleChange}
												employees={employeeOptions}
												disabled={isPending}
											/>
										)}
									</form.Field>
								</div>
							) : null}

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

function toSelectableEmployee(employee: PayrollAccessEmployeeOption): SelectableEmployee {
	return {
		id: employee.id,
		userId: employee.id,
		firstName: null,
		lastName: null,
		pronouns: null,
		position: null,
		role: "employee",
		isActive: true,
		teamId: null,
		user: {
			id: employee.id,
			name: employee.name,
			email: employee.email,
			image: null,
		},
		team: null,
	};
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

function toggleId(values: string[], id: string, checked: boolean): string[] {
	if (checked) {
		return values.includes(id) ? values : [...values, id];
	}
	return values.filter((value) => value !== id);
}
