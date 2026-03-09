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
import type { QueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useReducer } from "react";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/user-avatar";
import { queryKeys } from "@/lib/query";
import { Link } from "@/navigation";
import type { SelectableEmployee } from "../../employees/actions";

export const teamFormSchema = z.object({
	name: z.string().min(1, "Team name is required").max(100, "Team name is too long"),
	description: z.string().max(500, "Description is too long").optional(),
});

export type TeamFormValues = z.infer<typeof teamFormSchema>;

export interface TeamPageUiState {
	currentEmployee: { role?: string } | null;
	noEmployee: boolean;
	isEditing: boolean;
	showAddMember: boolean;
	showDeleteDialog: boolean;
	selectedMemberToRemove: string | null;
	availableEmployees: SelectableEmployee[];
	selectedEmployee: string;
}

type TeamPageUiAction =
	| { type: "setCurrentEmployee"; currentEmployee: TeamPageUiState["currentEmployee"] }
	| { type: "setNoEmployee"; value: boolean }
	| { type: "setEditing"; value: boolean }
	| { type: "setShowAddMember"; value: boolean }
	| { type: "setShowDeleteDialog"; value: boolean }
	| { type: "setSelectedMemberToRemove"; employeeId: string | null }
	| { type: "setAvailableEmployees"; employees: SelectableEmployee[] }
	| { type: "setSelectedEmployee"; employeeId: string }
	| { type: "resetAddMemberDialog" };

export const initialTeamPageUiState: TeamPageUiState = {
	currentEmployee: null,
	noEmployee: false,
	isEditing: false,
	showAddMember: false,
	showDeleteDialog: false,
	selectedMemberToRemove: null,
	availableEmployees: [],
	selectedEmployee: "",
};

export function teamPageUiReducer(
	state: TeamPageUiState,
	action: TeamPageUiAction,
): TeamPageUiState {
	switch (action.type) {
		case "setCurrentEmployee":
			return { ...state, currentEmployee: action.currentEmployee };
		case "setNoEmployee":
			return { ...state, noEmployee: action.value };
		case "setEditing":
			return { ...state, isEditing: action.value };
		case "setShowAddMember":
			return { ...state, showAddMember: action.value };
		case "setShowDeleteDialog":
			return { ...state, showDeleteDialog: action.value };
		case "setSelectedMemberToRemove":
			return { ...state, selectedMemberToRemove: action.employeeId };
		case "setAvailableEmployees":
			return { ...state, availableEmployees: action.employees };
		case "setSelectedEmployee":
			return { ...state, selectedEmployee: action.employeeId };
		case "resetAddMemberDialog":
			return { ...state, showAddMember: false, selectedEmployee: "" };
	}
	return state;
}

export function useTeamPageUiState() {
	return useReducer(teamPageUiReducer, initialTeamPageUiState);
}

export function extractTeamMemberIds(team: any): string[] {
	return ((team?.employees as Array<{ id: string }> | undefined) ?? []).map((member) => member.id);
}

export function TeamPageHeader({
	canManageSettings,
	onDelete,
}: {
	canManageSettings: boolean;
	onDelete: () => void;
}) {
	const { t } = useTranslate();

	return (
		<div className="flex items-center justify-between">
			<div>
				<div className="flex items-center gap-2">
					<Button variant="ghost" size="sm" asChild>
						<Link href="/settings/teams">
							<IconArrowBack className="size-4" />
						</Link>
					</Button>
					<h1 className="text-2xl font-semibold tracking-tight">
						{t("settings.teams.details.title", "Team Details")}
					</h1>
				</div>
				<p className="text-sm text-muted-foreground">
					{t("settings.teams.details.description", "Manage team information and members")}
				</p>
			</div>
			{canManageSettings ? (
				<div className="flex gap-2">
					<Button variant="destructive" size="sm" onClick={onDelete}>
						<IconTrash className="mr-2 size-4" />
						Delete Team
					</Button>
				</div>
			) : null}
		</div>
	);
}

export function TeamInfoCard(props: {
	team: any;
	isEditing: boolean;
	canManageSettings: boolean;
	loading: boolean;
	form: any;
	onStartEdit: () => void;
	onCancelEdit: () => void;
	onSubmit: () => void;
}) {
	const { team, isEditing, canManageSettings, loading, form, onStartEdit, onCancelEdit, onSubmit } =
		props;

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<CardTitle>Team Information</CardTitle>
					{canManageSettings && !isEditing ? (
						<Button variant="ghost" size="sm" onClick={onStartEdit}>
							Edit
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
									.min(1, "Team name is required")
									.max(100, "Team name is too long"),
							}}
						>
							{(field: any) => (
								<div className="space-y-2">
									<Label>Team Name</Label>
									<Input
										placeholder="Enter team name"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
									/>
									{field.state.meta.errors.length > 0 ? (
										<p className="text-sm text-destructive">
											{typeof field.state.meta.errors[0] === "string"
												? field.state.meta.errors[0]
												: (field.state.meta.errors[0] as any)?.message || "Invalid input"}
										</p>
									) : null}
								</div>
							)}
						</form.Field>

						<form.Field name="description">
							{(field: any) => (
								<div className="space-y-2">
									<Label>Description</Label>
									<Textarea
										placeholder="Enter team description"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
									/>
								</div>
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
								<IconX className="mr-2 size-4" />
								Cancel
							</Button>
							<Button type="button" size="sm" disabled={loading} onClick={onSubmit}>
								{loading ? (
									<IconLoader2 className="mr-2 size-4 animate-spin" />
								) : (
									<IconCheck className="mr-2 size-4" />
								)}
								Save
							</Button>
						</div>
					</div>
				) : (
					<>
						<div className="space-y-2">
							<div className="text-sm text-muted-foreground">Team Name</div>
							<div className="font-medium">{team.name}</div>
						</div>
						{team.description ? (
							<>
								<Separator />
								<div className="space-y-2">
									<div className="text-sm text-muted-foreground">Description</div>
									<div className="text-sm">{team.description}</div>
								</div>
							</>
						) : null}
						<Separator />
						<div className="space-y-2">
							<div className="text-sm text-muted-foreground">Members</div>
							<div className="flex items-center gap-2">
								<IconUsers className="size-4 text-muted-foreground" />
								<span className="font-medium">{team.employees?.length || 0}</span>
							</div>
						</div>
					</>
				)}
			</CardContent>
		</Card>
	);
}

export function TeamMembersCard(props: {
	team: any;
	canManageMembers: boolean;
	onOpenAddMember: () => void;
	onRemoveMember: (employeeId: string) => void;
}) {
	const { team, canManageMembers, onOpenAddMember, onRemoveMember } = props;

	return (
		<Card className="lg:col-span-2">
			<CardHeader>
				<div className="flex items-center justify-between">
					<div>
						<CardTitle>Team Members</CardTitle>
						<CardDescription>Employees assigned to this team</CardDescription>
					</div>
					{canManageMembers ? (
						<Button size="sm" onClick={onOpenAddMember}>
							<IconPlus className="mr-2 size-4" />
							Add Member
						</Button>
					) : null}
				</div>
			</CardHeader>
			<CardContent>
				{!team.employees || team.employees.length === 0 ? (
					<div className="flex flex-col items-center justify-center py-8">
						<IconUsers className="mb-4 size-12 text-muted-foreground" />
						<p className="text-sm text-muted-foreground">No members in this team</p>
					</div>
				) : (
					<div className="space-y-2">
						{team.employees.map((employee: any) => (
							<div
								key={employee.id}
								className="flex items-center justify-between rounded-lg border p-3"
							>
								<div className="flex items-center gap-3">
									<UserAvatar
										image={employee.user.image}
										seed={employee.id}
										name={employee.user.name}
										size="md"
									/>
									<div>
										<div className="font-medium">{employee.user.name}</div>
										<div className="text-sm text-muted-foreground">{employee.user.email}</div>
									</div>
									{employee.position ? (
										<Badge variant="secondary">{employee.position}</Badge>
									) : null}
								</div>
								{canManageMembers ? (
									<Button variant="ghost" size="sm" onClick={() => onRemoveMember(employee.id)}>
										<IconUserMinus className="size-4" />
									</Button>
								) : null}
							</div>
						))}
					</div>
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
}) {
	const {
		open,
		onOpenChange,
		availableEmployees,
		selectedEmployee,
		onSelectedEmployeeChange,
		onAddMember,
		loading,
	} = props;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Add Team Member</DialogTitle>
					<DialogDescription>Select an employee to add to this team</DialogDescription>
				</DialogHeader>
				<div className="space-y-4 py-4">
					<Select value={selectedEmployee} onValueChange={onSelectedEmployeeChange}>
						<SelectTrigger>
							<SelectValue placeholder="Select employee" />
						</SelectTrigger>
						<SelectContent>
							{availableEmployees.map((employee) => (
								<SelectItem key={employee.id} value={employee.id}>
									<div className="flex items-center gap-2">
										<span>{employee.user.name}</span>
										<span className="text-sm text-muted-foreground">({employee.user.email})</span>
									</div>
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
						Cancel
					</Button>
					<Button onClick={onAddMember} disabled={loading}>
						{loading ? <IconLoader2 className="mr-2 size-4 animate-spin" /> : null}
						Add Member
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export function RemoveMemberDialog(props: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
	loading: boolean;
}) {
	const { open, onOpenChange, onConfirm, loading } = props;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Remove Team Member</DialogTitle>
					<DialogDescription>
						Are you sure you want to remove this employee from the team? They will still have access
						to the organization.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
						Cancel
					</Button>
					<Button variant="destructive" onClick={onConfirm} disabled={loading}>
						{loading ? <IconLoader2 className="mr-2 size-4 animate-spin" /> : null}
						Remove
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export function DeleteTeamDialog(props: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
	loading: boolean;
}) {
	const { open, onOpenChange, onConfirm, loading } = props;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Delete Team</DialogTitle>
					<DialogDescription>
						Are you sure you want to delete this team? This action cannot be undone. Team members
						will not be deleted.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
						Cancel
					</Button>
					<Button variant="destructive" onClick={onConfirm} disabled={loading}>
						{loading ? <IconLoader2 className="mr-2 size-4 animate-spin" /> : null}
						Delete Team
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export function invalidateTeamQueries(queryClient: QueryClient, teamId: string) {
	queryClient.invalidateQueries({ queryKey: queryKeys.teams.detail(teamId) });
	queryClient.invalidateQueries({ queryKey: queryKeys.teams.all });
	queryClient.invalidateQueries({ queryKey: queryKeys.employees.all });
}
