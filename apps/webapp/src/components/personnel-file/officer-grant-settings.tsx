"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	getPersonnelFileOfficerAdminData,
	type PersonnelFileOfficerAdminData,
	type PersonnelFileOfficerGrantData,
	revokePersonnelFileOfficerGrantAction,
	type SavePersonnelFileOfficerGrantInput,
	savePersonnelFileOfficerGrantAction,
} from "@/app/[locale]/(app)/settings/personnel-files/officer-actions";
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
import { DOCUMENT_CATEGORIES, type DocumentCategory } from "@/lib/personnel-file/document.types";
import { queryKeys } from "@/lib/query/keys";
import { usePersonnelFileLabels } from "./document-labels";

const queryKey = queryKeys.personnelFile.officerGrants();

// A new grant covers every category until the administrator narrows it.
const DEFAULT_VALUES: SavePersonnelFileOfficerGrantInput = {
	officerEmployeeId: "",
	scope: "specific",
	teamIds: [],
	employeeIds: [],
	categories: [...DOCUMENT_CATEGORIES],
};

type Translate = ReturnType<typeof useTranslate>["t"];

function scopeSummary(grant: PersonnelFileOfficerGrantData, t: Translate): string {
	if (grant.scope === "all") {
		return t("settings.personnelFiles.officers.allScope", "All employees");
	}
	return t(
		"settings.personnelFiles.officers.scopeSummary",
		"{teamCount, plural, one {# team} other {# teams}}, {employeeCount, plural, one {# employee} other {# employees}}",
		{ teamCount: grant.teamIds.length, employeeCount: grant.employeeIds.length },
	);
}

function toggleCategory(
	values: DocumentCategory[],
	category: DocumentCategory,
	checked: boolean,
): DocumentCategory[] {
	const next = checked ? [...values, category] : values.filter((value) => value !== category);
	return DOCUMENT_CATEGORIES.filter((option) => next.includes(option));
}

function OfficerGrantEditor({ data }: { data: PersonnelFileOfficerAdminData }) {
	const { t } = useTranslate();
	const labels = usePersonnelFileLabels();
	const queryClient = useQueryClient();
	const [editingGrantId, setEditingGrantId] = useState<string | null>(null);
	const [isEditorOpen, setIsEditorOpen] = useState(false);
	const [revokingGrant, setRevokingGrant] = useState<PersonnelFileOfficerGrantData | null>(null);
	const [isRevoking, setIsRevoking] = useState(false);
	const invalidate = () => queryClient.invalidateQueries({ queryKey });
	const people = [...data.employees, ...data.departedEmployees];
	const nameOf = (employeeId: string) =>
		people.find((person) => person.id === employeeId)?.name ?? employeeId;
	const officerOptions = data.employees.map((person) =>
		toSelectableEmployee(person, { isActive: true }),
	);
	// Departed employees can be named: their personnel file stays managed.
	const namedOptions = [
		...officerOptions,
		...data.departedEmployees.map((person) => toSelectableEmployee(person, { isActive: false })),
	];

	const form = useForm({
		defaultValues: DEFAULT_VALUES,
		onSubmit: async ({ value }) => {
			const result = await savePersonnelFileOfficerGrantAction(value);
			if (!result.success) {
				toast.error(
					result.error ||
						t(
							"settings.personnelFiles.officers.saveFailed",
							"Failed to save the personnel file officer",
						),
				);
				return;
			}
			await invalidate();
			toast.success(t("settings.personnelFiles.officers.saved", "Personnel file officer saved"));
			setIsEditorOpen(false);
			setEditingGrantId(null);
		},
	});
	const values = useStore(form.store, (state) => state.values);
	const isSubmitting = useStore(form.store, (state) => state.isSubmitting);
	const editingGrant = data.grants.find((grant) => grant.id === editingGrantId);
	const officerIds = new Set(data.grants.map((grant) => grant.officerEmployeeId));
	const selectedEmployeeIds = new Set(values.employeeIds);
	const selectedDepartedNames = data.departedEmployees
		.filter((person) => selectedEmployeeIds.has(person.id))
		.map((person) => person.name);
	const canSubmit =
		values.officerEmployeeId.length > 0 &&
		values.categories.length > 0 &&
		(values.scope === "all" || values.teamIds.length > 0 || values.employeeIds.length > 0) &&
		!isSubmitting;

	const openEditor = (grant: PersonnelFileOfficerGrantData | null) => {
		const next = grant ?? DEFAULT_VALUES;
		setEditingGrantId(grant?.id ?? null);
		form.setFieldValue("officerEmployeeId", next.officerEmployeeId);
		form.setFieldValue("scope", next.scope);
		form.setFieldValue("teamIds", next.teamIds);
		form.setFieldValue("employeeIds", next.employeeIds);
		form.setFieldValue("categories", next.categories);
		setIsEditorOpen(true);
	};

	const revoke = async () => {
		if (!revokingGrant) return;
		setIsRevoking(true);
		await (async () => {
			const result = await revokePersonnelFileOfficerGrantAction({ grantId: revokingGrant.id });
			if (!result.success) {
				toast.error(
					result.error ||
						t(
							"settings.personnelFiles.officers.revokeFailed",
							"Failed to revoke the personnel file officer",
						),
				);
				return;
			}
			await invalidate();
			toast.success(
				t("settings.personnelFiles.officers.revoked", "Personnel file officer revoked"),
			);
			if (editingGrantId === revokingGrant.id) {
				setIsEditorOpen(false);
				setEditingGrantId(null);
			}
			setRevokingGrant(null);
		})().finally(() => {
			setIsRevoking(false);
		});
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
							<p>{grant.categories.map((category) => labels.categories[category]).join(", ")}</p>
						</>
					),
				}))}
				canAdd={data.employees.some((person) => !officerIds.has(person.id))}
				onAdd={() => openEditor(null)}
				onEdit={(id) => openEditor(data.grants.find((grant) => grant.id === id) ?? null)}
				onRevoke={(id) => setRevokingGrant(data.grants.find((grant) => grant.id === id) ?? null)}
				copy={{
					add: t("settings.personnelFiles.officers.add", "Add personnel file officer"),
					empty: t(
						"settings.personnelFiles.officers.empty",
						"No personnel file officers yet. Only owners and admins manage personnel files.",
					),
					edit: t("settings.personnelFiles.officers.edit", "Edit"),
					revoke: t("settings.personnelFiles.officers.revoke", "Revoke"),
				}}
			/>

			<RevokeGrantDialog
				open={revokingGrant !== null}
				pending={isRevoking}
				onConfirm={() => void revoke()}
				onClose={() => setRevokingGrant(null)}
				copy={{
					title: t(
						"settings.personnelFiles.officers.revokeTitle",
						"Revoke personnel file officer?",
					),
					description: t(
						"settings.personnelFiles.officers.revokeDescription",
						"{name} loses access to personnel files immediately. Adding them again later creates a new grant.",
						{ name: revokingGrant ? nameOf(revokingGrant.officerEmployeeId) : "" },
					),
					cancel: t("common.cancel", "Cancel"),
					confirm: t("settings.personnelFiles.officers.revokeConfirm", "Revoke access"),
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
									? t("settings.personnelFiles.officers.editTitle", "Edit personnel file officer")
									: t("settings.personnelFiles.officers.addTitle", "Add personnel file officer")}
							</CardTitle>
							<CardDescription>
								{t(
									"settings.personnelFiles.officers.editorDescription",
									"Choose whose personnel files the officer manages and which document categories. Officers see, upload, edit, delete and download every document in their scope.",
								)}
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-6">
							<form.Field name="officerEmployeeId">
								{(field) => (
									<EmployeeSingleSelect
										label={t("settings.personnelFiles.officers.officer", "Personnel file officer")}
										placeholder={t(
											"settings.personnelFiles.officers.selectOfficer",
											"Select employee",
										)}
										value={field.state.value || null}
										onChange={(value) => field.handleChange(value ?? "")}
										excludeIds={[...officerIds].filter(
											(id) => id !== editingGrant?.officerEmployeeId,
										)}
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
								testIdPrefix="personnel-file-officer-team"
								copy={{
									scope: t("settings.personnelFiles.officers.scope", "Officer scope"),
									allScope: t("settings.personnelFiles.officers.allScope", "All employees"),
									specificScope: t(
										"settings.personnelFiles.officers.specificScope",
										"Specific teams or employees",
									),
									allScopeDescription: t(
										"settings.personnelFiles.officers.allScopeDescription",
										"Every employee of this organization, former employees included.",
									),
									specificScopeDescription: t(
										"settings.personnelFiles.officers.specificScopeDescription",
										"The named employees and whoever currently belongs to one of the teams. A team change moves the employee's file in or out of scope.",
									),
									teams: t("settings.personnelFiles.officers.teams", "Teams"),
									noTeams: t("settings.personnelFiles.officers.noTeams", "No teams available"),
									employees: t("settings.personnelFiles.officers.employees", "Employees"),
									selectEmployees: t(
										"settings.personnelFiles.officers.selectEmployees",
										"Select employees",
									),
									departedNotice:
										selectedDepartedNames.length > 0
											? t(
													"settings.personnelFiles.officers.departedNamed",
													"{names} left the organization. Their personnel file stays with this officer.",
													{ names: selectedDepartedNames.join(", ") },
												)
											: null,
								}}
							/>

							<OfficerDocumentCategories
								categories={values.categories}
								onChange={(categories) => form.setFieldValue("categories", categories)}
								disabled={isSubmitting}
							/>

							<div className="flex flex-wrap gap-2">
								<Button type="submit" disabled={!canSubmit}>
									{isSubmitting ? (
										<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
									) : null}
									{t("settings.personnelFiles.officers.save", "Save personnel file officer")}
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
 * Personnel file officers (#866): access to employee documents for people
 * who are not owners or admins, scoped to employees or teams and to document
 * categories.
 */
export function PersonnelFileOfficerSettingsCard() {
	const { t } = useTranslate();
	const { data, isLoading, isError, refetch } = useQuery({
		queryKey,
		queryFn: async () => {
			const result = await getPersonnelFileOfficerAdminData();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t("settings.personnelFiles.officers.title", "Personnel file officers")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.personnelFiles.officers.intro",
						"Personnel file officers manage employee documents of chosen categories, for all employees or for named teams and employees. Owners and admins always have this access. Managing employees, payroll access and expense officer grants never grant it.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{isLoading && <Skeleton aria-hidden="true" className="h-32 w-full" />}
				{isError && (
					<div className="space-y-2">
						<p className="text-sm text-destructive" role="alert">
							{t(
								"settings.personnelFiles.officers.loadFailed",
								"The personnel file officers could not be loaded.",
							)}
						</p>
						<Button type="button" variant="outline" onClick={() => void refetch()}>
							{t("common.retry", "Retry")}
						</Button>
					</div>
				)}
				{data && <OfficerGrantEditor data={data} />}
			</CardContent>
		</Card>
	);
}

function OfficerDocumentCategories({
	categories,
	onChange,
	disabled,
}: {
	categories: DocumentCategory[];
	onChange: (categories: DocumentCategory[]) => void;
	disabled: boolean;
}) {
	const { t } = useTranslate();
	const labels = usePersonnelFileLabels();
	return (
		<fieldset className="space-y-3">
			<legend className="text-sm font-medium">
				{t("settings.personnelFiles.officers.categories", "Document categories")}
			</legend>
			<div className="grid gap-2 sm:grid-cols-2">
				{DOCUMENT_CATEGORIES.map((category) => (
					<div key={category} className="flex items-start gap-2">
						<Checkbox
							id={`personnel-file-officer-category-${category}`}
							checked={categories.includes(category)}
							onCheckedChange={(checked) =>
								onChange(toggleCategory(categories, category, checked === true))
							}
							disabled={disabled}
						/>
						<Label htmlFor={`personnel-file-officer-category-${category}`} className="font-normal">
							{labels.categories[category]}
						</Label>
					</div>
				))}
			</div>
			<p className="text-muted-foreground text-sm">
				{categories.length === 0
					? t(
							"settings.personnelFiles.officers.categoriesRequired",
							"Choose at least one document category.",
						)
					: t(
							"settings.personnelFiles.officers.categoriesDescription",
							"The officer never sees documents of other categories, not even of employees in scope.",
						)}
			</p>
		</fieldset>
	);
}
