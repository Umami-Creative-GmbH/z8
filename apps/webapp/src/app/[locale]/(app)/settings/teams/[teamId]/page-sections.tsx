"use client";

import {
	IconArrowBack,
	IconCheck,
	IconLoader2,
	IconPlus,
	IconTrash,
	IconUserMinus,
	IconUsers,
	IconX,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { z } from "zod";
import { EmployeeSingleSelect } from "@/components/employee-select";
import {
	FormerEmployeeBadge,
	ShowFormerEmployeesSwitch,
} from "@/components/former-employees/former-employee-ui";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { ConfirmActionDialog } from "@/components/settings/confirm-action-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/user-avatar";
import { useEmployeeClockStatuses } from "@/lib/query";
import { Link } from "@/navigation";
import type { SelectableEmployee } from "../../employees/actions";

export function TeamPageHeader({
	teamName,
	canManageSettings,
	onDelete,
}: {
	/** The team being viewed; the generic title stands in until it is known. */
	teamName?: string;
	canManageSettings: boolean;
	onDelete: () => void;
}) {
	const { t } = useTranslate();

	return (
		<PageHeader
			scope={
				<Link
					href="/settings/teams"
					className="inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					<IconArrowBack className="size-4" aria-hidden="true" />
					{t("settings.teams.detail.back", "Back to teams")}
				</Link>
			}
			title={teamName ?? t("settings.teams.detail.title", "Team Details")}
			description={t("settings.teams.detail.description", "Manage team information and members")}
			actions={
				canManageSettings ? (
					<Button variant="destructive" size="sm" onClick={onDelete}>
						<IconTrash className="mr-2 size-4" aria-hidden="true" />
						{t("settings.teams.detail.delete.title", "Delete Team")}
					</Button>
				) : undefined
			}
		/>
	);
}

export function TeamInfoCard(props: {
	team: any;
	managerOptions?: SelectableEmployee[];
	isEditing: boolean;
	canManageSettings: boolean;
	loading: boolean;
	form: any;
	onStartEdit: () => void;
	onCancelEdit: () => void;
	onSubmit: () => void;
}) {
	const {
		team,
		managerOptions = [],
		isEditing,
		canManageSettings,
		loading,
		form,
		onStartEdit,
		onCancelEdit,
		onSubmit,
	} = props;
	const { t } = useTranslate();
	const teamNameInputId = "team-detail-name";
	const teamDescriptionInputId = "team-detail-description";
	const teamPrimaryManagerInputId = "team-detail-primary-manager";

	return (
		<Card>
			<CardHeader>
				<div className="flex flex-wrap items-center justify-between gap-2">
					<CardTitle>{t("settings.teams.detail.info.title", "Team Information")}</CardTitle>
					{canManageSettings && !isEditing ? (
						<Button variant="ghost" size="sm" onClick={onStartEdit}>
							{t("settings.teams.detail.actions.edit", "Edit")}
						</Button>
					) : null}
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				{isEditing ? (
					<div className="space-y-4">
						<form.Field
							name="name"
							validators={{
								onChange: z
									.string()
									.min(
										1,
										t("settings.teams.detail.validation.teamNameRequired", "Team name is required"),
									)
									.max(
										100,
										t("settings.teams.detail.validation.teamNameTooLong", "Team name is too long"),
									),
							}}
						>
							{(field: any) => (
								<div className="space-y-2">
									<Label htmlFor={teamNameInputId}>
										{t("settings.teams.detail.info.teamName", "Team Name")}
									</Label>
									<Input
										id={teamNameInputId}
										placeholder={t(
											"settings.teams.detail.info.teamNamePlaceholder",
											"Enter team name",
										)}
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
									/>
									{field.state.meta.errors.length > 0 ? (
										<p className="text-sm text-destructive">
											{typeof field.state.meta.errors[0] === "string"
												? field.state.meta.errors[0]
												: (field.state.meta.errors[0] as any)?.message ||
													t("settings.teams.detail.validation.invalidInput", "Invalid input")}
										</p>
									) : null}
								</div>
							)}
						</form.Field>

						<form.Field name="description">
							{(field: any) => (
								<div className="space-y-2">
									<Label htmlFor={teamDescriptionInputId}>
										{t("settings.teams.detail.info.description", "Description")}
									</Label>
									<Textarea
										id={teamDescriptionInputId}
										placeholder={t(
											"settings.teams.detail.info.descriptionPlaceholder",
											"Enter team description",
										)}
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
									/>
								</div>
							)}
						</form.Field>

						<form.Field name="primaryManagerId">
							{(field: any) => (
								<EmployeeSingleSelect
									id={teamPrimaryManagerInputId}
									label={t("settings.teams.detail.info.primaryManager", "Primary Manager")}
									placeholder={t(
										"settings.teams.detail.info.noPrimaryManager",
										"No primary manager assigned",
									)}
									allowClear
									clearLabel={t(
										"settings.teams.detail.info.noPrimaryManager",
										"No primary manager assigned",
									)}
									value={field.state.value ?? null}
									onChange={(value) => field.handleChange(value)}
									employees={managerOptions}
								/>
							)}
						</form.Field>

						<div className="flex justify-end gap-2">
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={onCancelEdit}
								disabled={loading}
							>
								<IconX className="mr-2 size-4" aria-hidden="true" />
								{t("settings.teams.detail.actions.cancel", "Cancel")}
							</Button>
							<Button type="button" size="sm" disabled={loading} onClick={onSubmit}>
								{loading ? (
									<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
								) : (
									<IconCheck className="mr-2 size-4" aria-hidden="true" />
								)}
								{t("settings.teams.detail.actions.save", "Save")}
							</Button>
						</div>
					</div>
				) : (
					<>
						<div className="space-y-2">
							<div className="text-sm text-muted-foreground">
								{t("settings.teams.detail.info.teamName", "Team Name")}
							</div>
							<div className="break-words font-medium">{team.name}</div>
						</div>
						{team.description ? (
							<>
								<Separator />
								<div className="space-y-2">
									<div className="text-sm text-muted-foreground">
										{t("settings.teams.detail.info.description", "Description")}
									</div>
									<div className="whitespace-pre-line break-words text-sm">{team.description}</div>
								</div>
							</>
						) : null}
						<Separator />
						<div className="space-y-2">
							<div className="text-sm text-muted-foreground">
								{t("settings.teams.detail.info.primaryManager", "Primary Manager")}
							</div>
							<div className="break-words font-medium">
								{team.primaryManager?.user?.name ??
									t("settings.teams.detail.info.noPrimaryManager", "No primary manager assigned")}
							</div>
						</div>
						<Separator />
						<div className="space-y-2">
							<div className="text-sm text-muted-foreground">
								{t("settings.teams.detail.info.members", "Members")}
							</div>
							<div className="flex items-center gap-2">
								<IconUsers className="size-4 text-muted-foreground" aria-hidden="true" />
								<span className="font-medium tabular-nums">{currentTeamMembers(team).length}</span>
							</div>
						</div>
					</>
				)}
			</CardContent>
		</Card>
	);
}

type TeamMemberRow = { id: string; isFormer?: boolean };

/** The members on the current roster; former members are counted and listed apart (#1438). */
function currentTeamMembers(team: { employees?: TeamMemberRow[] }): TeamMemberRow[] {
	return (team.employees ?? []).filter((employee) => !employee.isFormer);
}

export function TeamMembersCard(props: {
	team: any;
	canManageMembers: boolean;
	onOpenAddMember: () => void;
	onRemoveMember: (employeeId: string) => void;
}) {
	const { team, canManageMembers, onOpenAddMember, onRemoveMember } = props;
	const { t } = useTranslate();
	// Former members stay hidden until the admin asks for them (#1438).
	const [showFormer, setShowFormer] = useState(false);
	const allMembers: any[] = team.employees ?? [];
	const formerCount = allMembers.length - currentTeamMembers(team).length;
	const members = showFormer ? allMembers : currentTeamMembers(team);
	const presence = useEmployeeClockStatuses(
		members.map((employee: { id: string }) => employee.id),
		{ polling: false },
	);

	return (
		<Card className="lg:col-span-2">
			<CardHeader>
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="min-w-0">
						<CardTitle>{t("settings.teams.detail.members.title", "Team Members")}</CardTitle>
						<CardDescription>
							{t("settings.teams.detail.members.description", "Employees assigned to this team")}
						</CardDescription>
					</div>
					{canManageMembers ? (
						<Button size="sm" onClick={onOpenAddMember}>
							<IconPlus className="mr-2 size-4" aria-hidden="true" />
							{t("settings.teams.detail.members.add", "Add Member")}
						</Button>
					) : null}
				</div>
				{formerCount > 0 ? (
					<ShowFormerEmployeesSwitch checked={showFormer} onCheckedChange={setShowFormer} />
				) : null}
			</CardHeader>
			<CardContent>
				{members.length === 0 ? (
					<div className="flex flex-col items-start gap-3 py-6 sm:items-center sm:text-center">
						<IconUsers className="size-8 text-muted-foreground" aria-hidden="true" />
						<p className="text-sm text-muted-foreground">
							{t("settings.teams.detail.members.empty", "No members in this team")}
						</p>
						{canManageMembers ? (
							<Button size="sm" variant="outline" onClick={onOpenAddMember}>
								<IconPlus className="mr-2 size-4" aria-hidden="true" />
								{t("settings.teams.detail.members.add", "Add Member")}
							</Button>
						) : null}
					</div>
				) : (
					<ul className="space-y-2">
						{members.map((employee: any) => (
							<li
								key={employee.id}
								className="flex items-center justify-between gap-3 rounded-lg border p-3"
							>
								<div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
									<UserAvatar
										image={employee.user.image}
										seed={employee.id}
										name={employee.user.name}
										size="md"
										clockStatus={presence.getStatus(employee.id)}
									/>
									<div className="min-w-0 flex-1">
										<div className="truncate font-medium" title={employee.user.name}>
											{employee.user.name}
										</div>
										<div
											className="truncate text-sm text-muted-foreground"
											title={employee.user.email}
										>
											{employee.user.email}
										</div>
									</div>
									{employee.position ? (
										<Badge variant="secondary" className="max-w-full truncate">
											{employee.position}
										</Badge>
									) : null}
									{employee.isFormer ? <FormerEmployeeBadge since={employee.formerSince} /> : null}
								</div>
								{canManageMembers ? (
									<Button
										variant="ghost"
										size="sm"
										className="shrink-0"
										onClick={() => onRemoveMember(employee.id)}
										aria-label={t(
											"settings.teams.detail.members.removeNamed",
											"Remove {name} from team",
											{ name: employee.user.name },
										)}
									>
										<IconUserMinus className="size-4" aria-hidden="true" />
									</Button>
								) : null}
							</li>
						))}
					</ul>
				)}
			</CardContent>
		</Card>
	);
}

export function AddMemberDialog(props: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	availableEmployees: SelectableEmployee[];
	selectedEmployee: string;
	onSelectedEmployeeChange: (employeeId: string) => void;
	onAddMember: () => void;
	loading: boolean;
	/** The picker's options are still being fetched. */
	isLoadingEmployees?: boolean;
	/** Why the picker's options could not be fetched. */
	employeesError?: string | null;
	onRetryLoadEmployees?: () => void;
}) {
	const {
		open,
		onOpenChange,
		availableEmployees,
		selectedEmployee,
		onSelectedEmployeeChange,
		onAddMember,
		loading,
		isLoadingEmployees = false,
		employeesError = null,
		onRetryLoadEmployees,
	} = props;
	const { t } = useTranslate();
	const employeeSelectId = "team-detail-member-select";
	const canPick = !isLoadingEmployees && !employeesError && availableEmployees.length > 0;

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>
						{t("settings.teams.detail.addMember.title", "Add Team Member")}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{t(
							"settings.teams.detail.addMember.description",
							"Select an employee to add to this team",
						)}
					</ActionPanelDescription>
				</ActionPanelHeader>
				<ActionPanelBody className="space-y-4">
					{isLoadingEmployees ? (
						<div
							role="status"
							aria-live="polite"
							className="flex h-9 items-center gap-2 rounded-md border border-dashed px-3 text-sm text-muted-foreground"
						>
							<IconLoader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
							{t("settings.teams.detail.addMember.loadingEmployees", "Loading employees…")}
						</div>
					) : employeesError ? (
						<div
							role="alert"
							className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3"
						>
							<p className="text-sm">{employeesError}</p>
							{onRetryLoadEmployees ? (
								<Button variant="outline" size="sm" onClick={onRetryLoadEmployees}>
									{t("common.retry", "Try again")}
								</Button>
							) : null}
						</div>
					) : availableEmployees.length === 0 ? (
						<p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
							{t(
								"settings.teams.detail.addMember.noEmployeesAvailable",
								"No employees available to add",
							)}
						</p>
					) : (
						<EmployeeSingleSelect
							id={employeeSelectId}
							label={t("settings.teams.detail.selectEmployee", "Select employee")}
							placeholder={t("settings.teams.detail.addMember.selectEmployee", "Select employee")}
							value={selectedEmployee || null}
							onChange={(value) => onSelectedEmployeeChange(value ?? "")}
							employees={availableEmployees}
						/>
					)}
				</ActionPanelBody>
				<ActionPanelFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
						{t("settings.teams.detail.actions.cancel", "Cancel")}
					</Button>
					<Button onClick={onAddMember} disabled={loading || !canPick}>
						{loading ? (
							<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
						) : null}
						{t("settings.teams.detail.members.add", "Add Member")}
					</Button>
				</ActionPanelFooter>
			</ActionPanelContent>
		</ActionPanel>
	);
}

export function RemoveMemberDialog(props: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
	loading: boolean;
	/** The member being removed, named in the confirmation. */
	memberName?: string;
}) {
	const { open, onOpenChange, onConfirm, loading, memberName } = props;
	const { t } = useTranslate();

	// Stays open until the removal settles; the page closes it on success.
	return (
		<ConfirmActionDialog
			open={open}
			onOpenChange={onOpenChange}
			title={t("settings.teams.detail.removeMember.title", "Remove Team Member")}
			description={
				<>
					{memberName ? (
						<span className="mb-1 block break-words font-medium text-foreground">
							{memberName}
						</span>
					) : null}
					{t(
						"settings.teams.detail.removeMember.description",
						"Are you sure you want to remove this employee from the team? They will still have access to the organization.",
					)}
				</>
			}
			cancelLabel={t("settings.teams.detail.actions.cancel", "Cancel")}
			confirmLabel={t("settings.teams.detail.removeMember.confirm", "Remove")}
			isPending={loading}
			onConfirm={onConfirm}
		/>
	);
}

export function DeleteTeamDialog(props: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
	loading: boolean;
	/** The team being deleted, named in the confirmation. */
	teamName?: string;
}) {
	const { open, onOpenChange, onConfirm, loading, teamName } = props;
	const { t } = useTranslate();

	// Stays open until the deletion settles; the page closes it on success.
	return (
		<ConfirmActionDialog
			open={open}
			onOpenChange={onOpenChange}
			title={t("settings.teams.detail.delete.title", "Delete Team")}
			description={
				<>
					{teamName ? (
						<span className="mb-1 block break-words font-medium text-foreground">
							{teamName}
						</span>
					) : null}
					{t(
						"settings.teams.detail.delete.description",
						"Are you sure you want to delete this team? This action cannot be undone. Team members will not be deleted.",
					)}
				</>
			}
			cancelLabel={t("settings.teams.detail.actions.cancel", "Cancel")}
			confirmLabel={t("settings.teams.detail.delete.title", "Delete Team")}
			isPending={loading}
			onConfirm={onConfirm}
		/>
	);
}
