"use client";

import { IconLoader2, IconPlus, IconX } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { type ReactNode, useId, useState } from "react";
import { toast } from "sonner";
import {
	addProjectAssignment,
	addProjectManager,
	getEmployeesForSelection,
	getTeamsForSelection,
	type ProjectWithDetails,
	removeProjectAssignment,
	removeProjectManager,
} from "@/app/[locale]/(app)/settings/projects/actions";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type { ServerActionResult } from "@/lib/effect/result";
import { queryKeys } from "@/lib/query";

interface ProjectMembersPanelProps {
	organizationId: string;
	project: ProjectWithDetails | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Only org admins may add or remove project managers (#367). */
	canManageProjectManagers: boolean;
	onChanged: () => void;
}

interface MemberRow {
	key: string;
	name: string;
	/** Omitted when the viewer may not remove this row. */
	onRemove?: () => Promise<ServerActionResult<void>>;
}

interface SelectionOption {
	id: string;
	name: string;
}

function MemberSection({
	title,
	emptyText,
	rows,
	onChanged,
	children,
}: {
	title: string;
	emptyText: string;
	rows: MemberRow[];
	onChanged: () => void;
	children?: ReactNode;
}) {
	const { t } = useTranslate();
	const headingId = useId();
	const [removingKey, setRemovingKey] = useState<string | null>(null);

	async function remove(row: MemberRow) {
		if (!row.onRemove) return;
		setRemovingKey(row.key);
		const result = await row.onRemove().catch(() => null);
		setRemovingKey(null);
		if (result?.success) {
			toast.success(t("settings.projects.members.removed", "{name} removed", { name: row.name }));
			onChanged();
			return;
		}
		toast.error(
			result?.error ||
				t("settings.projects.members.removeFailed", "Failed to remove {name}", { name: row.name }),
		);
	}

	return (
		<section aria-labelledby={headingId} className="space-y-3">
			<h3 id={headingId} className="text-sm font-medium">
				{title}
			</h3>
			{rows.length === 0 ? (
				<p className="text-sm text-muted-foreground">{emptyText}</p>
			) : (
				<ul className="divide-y rounded-md border">
					{rows.map((row) => (
						<li key={row.key} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
							<span>{row.name}</span>
							{row.onRemove && (
								<Button
									type="button"
									variant="ghost"
									size="icon"
									className="size-8"
									disabled={removingKey !== null}
									aria-label={t("settings.projects.members.remove", "Remove {name}", {
										name: row.name,
									})}
									onClick={() => remove(row)}
								>
									{removingKey === row.key ? (
										<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
									) : (
										<IconX className="size-4" aria-hidden="true" />
									)}
								</Button>
							)}
						</li>
					))}
				</ul>
			)}
			{children}
		</section>
	);
}

function AddMemberForm({
	pickerLabel,
	placeholder,
	submitLabel,
	options,
	onAdd,
	successMessage,
	failureMessage,
	onChanged,
}: {
	pickerLabel: string;
	placeholder: string;
	submitLabel: string;
	options: SelectionOption[];
	onAdd: (targetId: string) => Promise<ServerActionResult<void>>;
	successMessage: string;
	failureMessage: string;
	onChanged: () => void;
}) {
	const form = useForm({
		defaultValues: { targetId: "" },
		onSubmit: async ({ value, formApi }) => {
			if (!value.targetId) return;
			const result = await onAdd(value.targetId).catch(() => null);
			if (result?.success) {
				toast.success(successMessage);
				formApi.reset();
				onChanged();
				return;
			}
			toast.error(result?.error || failureMessage);
		},
	});

	return (
		<form
			className="flex items-center gap-2"
			onSubmit={(event) => {
				event.preventDefault();
				form.handleSubmit();
			}}
		>
			<form.Field name="targetId">
				{(field) => (
					<Select value={field.state.value} onValueChange={field.handleChange}>
						<SelectTrigger aria-label={pickerLabel} className="flex-1">
							<SelectValue placeholder={placeholder} />
						</SelectTrigger>
						<SelectContent>
							{options.map((option) => (
								<SelectItem key={option.id} value={option.id}>
									{option.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				)}
			</form.Field>
			<form.Subscribe selector={(state) => [state.values.targetId, state.isSubmitting] as const}>
				{([targetId, isSubmitting]) => (
					<Button type="submit" variant="outline" disabled={!targetId || isSubmitting}>
						{isSubmitting ? (
							<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
						) : (
							<IconPlus className="size-4" aria-hidden="true" />
						)}
						{submitLabel}
					</Button>
				)}
			</form.Subscribe>
		</form>
	);
}

export function ProjectMembersPanel({
	organizationId,
	project,
	open,
	onOpenChange,
	canManageProjectManagers,
	onChanged,
}: ProjectMembersPanelProps) {
	const { t } = useTranslate();
	const assignments = project?.assignments ?? [];
	const teamAssignments = assignments.filter((assignment) => assignment.type === "team");
	const employeeAssignments = assignments.filter((assignment) => assignment.type === "employee");

	const { data: teams = [] } = useQuery({
		queryKey: queryKeys.projects.teamSelection(organizationId),
		queryFn: async () => {
			const result = await getTeamsForSelection(organizationId);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: open,
	});

	const { data: employees = [] } = useQuery({
		queryKey: queryKeys.projects.employeeSelection(organizationId),
		queryFn: async () => {
			const result = await getEmployeesForSelection(organizationId);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: open,
	});

	const assignedTeamIds = new Set(teamAssignments.map((assignment) => assignment.teamId));
	const assignedEmployeeIds = new Set(
		employeeAssignments.map((assignment) => assignment.employeeId),
	);
	const managers = project?.managers ?? [];
	const managerEmployeeIds = new Set(managers.map((manager) => manager.employeeId));

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>
						{t("settings.projects.members.title", "Project members")}
					</ActionPanelTitle>
					<ActionPanelDescription>{project?.name}</ActionPanelDescription>
				</ActionPanelHeader>
				<ActionPanelBody className="space-y-6">
					<MemberSection
						title={t("settings.projects.members.teams", "Teams")}
						emptyText={t("settings.projects.members.noTeams", "No teams assigned")}
						onChanged={onChanged}
						rows={teamAssignments.map((assignment) => ({
							key: assignment.id,
							name: assignment.teamName ?? "",
							onRemove: () => removeProjectAssignment(assignment.id),
						}))}
					>
						{project && (
							<AddMemberForm
								pickerLabel={t("settings.projects.members.teamPicker", "Team to assign")}
								placeholder={t("settings.projects.members.selectTeam", "Select a team")}
								submitLabel={t("settings.projects.members.assignTeam", "Assign team")}
								options={teams.filter((team) => !assignedTeamIds.has(team.id))}
								onAdd={(teamId) => addProjectAssignment(project.id, "team", teamId)}
								successMessage={t("settings.projects.members.teamAssigned", "Team assigned")}
								failureMessage={t(
									"settings.projects.members.teamAssignFailed",
									"Failed to assign team",
								)}
								onChanged={onChanged}
							/>
						)}
					</MemberSection>
					<MemberSection
						title={t("settings.projects.members.employees", "Employees")}
						emptyText={t("settings.projects.members.noEmployees", "No employees assigned")}
						onChanged={onChanged}
						rows={employeeAssignments.map((assignment) => ({
							key: assignment.id,
							name: assignment.employeeName ?? "",
							onRemove: () => removeProjectAssignment(assignment.id),
						}))}
					>
						{project && (
							<AddMemberForm
								pickerLabel={t("settings.projects.members.employeePicker", "Employee to assign")}
								placeholder={t("settings.projects.members.selectEmployee", "Select an employee")}
								submitLabel={t("settings.projects.members.assignEmployee", "Assign employee")}
								options={employees.filter((employee) => !assignedEmployeeIds.has(employee.id))}
								onAdd={(employeeId) => addProjectAssignment(project.id, "employee", employeeId)}
								successMessage={t(
									"settings.projects.members.employeeAssigned",
									"Employee assigned",
								)}
								failureMessage={t(
									"settings.projects.members.employeeAssignFailed",
									"Failed to assign employee",
								)}
								onChanged={onChanged}
							/>
						)}
					</MemberSection>
					<MemberSection
						title={t("settings.projects.members.managers", "Project managers")}
						emptyText={t("settings.projects.members.noManagers", "No project managers")}
						onChanged={onChanged}
						rows={managers.map((manager) => ({
							key: manager.id,
							name: manager.employeeName,
							onRemove:
								project && canManageProjectManagers
									? () => removeProjectManager(project.id, manager.employeeId)
									: undefined,
						}))}
					>
						{project && canManageProjectManagers ? (
							<AddMemberForm
								pickerLabel={t("settings.projects.members.managerPicker", "Project manager to add")}
								placeholder={t("settings.projects.members.selectEmployee", "Select an employee")}
								submitLabel={t("settings.projects.members.addManager", "Add project manager")}
								options={employees.filter((employee) => !managerEmployeeIds.has(employee.id))}
								onAdd={(employeeId) => addProjectManager(project.id, employeeId)}
								successMessage={t(
									"settings.projects.members.managerAdded",
									"Project manager added",
								)}
								failureMessage={t(
									"settings.projects.members.managerAddFailed",
									"Failed to add project manager",
								)}
								onChanged={onChanged}
							/>
						) : (
							<p className="text-xs text-muted-foreground">
								{t(
									"settings.projects.members.managersReadOnly",
									"Only organization admins can change project managers.",
								)}
							</p>
						)}
					</MemberSection>
				</ActionPanelBody>
			</ActionPanelContent>
		</ActionPanel>
	);
}
