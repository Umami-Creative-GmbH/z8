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
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { use, useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { getCurrentEmployee } from "@/app/[locale]/(app)/approvals/actions";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
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
import { Link, useRouter } from "@/navigation";
import { listEmployees } from "../../employees/actions";
import { addTeamMember, deleteTeam, getTeam, removeTeamMember, updateTeam } from "../actions";

const teamFormSchema = z.object({
	name: z.string().min(1, "Team name is required").max(100, "Team name is too long"),
	description: z.string().max(500, "Description is too long").optional(),
});

type TeamFormValues = z.infer<typeof teamFormSchema>;

export default function TeamDetailPage({ params }: { params: Promise<{ teamId: string }> }) {
	const { teamId } = use(params);
	const { t } = useTranslate();
	const router = useRouter();
	const queryClient = useQueryClient();
	const [currentEmployee, setCurrentEmployee] = useState<any>(null);
	const [noEmployee, setNoEmployee] = useState(false);
	const [canManageSettings, setCanManageSettings] = useState(false);
	const [canManageMembers, setCanManageMembers] = useState(false);
	const [isEditing, setIsEditing] = useState(false);
	const [showAddMember, setShowAddMember] = useState(false);
	const [showDeleteDialog, setShowDeleteDialog] = useState(false);
	const [selectedMemberToRemove, setSelectedMemberToRemove] = useState<string | null>(null);
	const [availableEmployees, setAvailableEmployees] = useState<any[]>([]);
	const [selectedEmployee, setSelectedEmployee] = useState<string>("");

	const form = useForm({
		defaultValues: {
			name: "",
			description: "",
		},
		onSubmit: async ({ value }) => {
			updateTeamMutation.mutate(value);
		},
	});

	// Fetch team data with TanStack Query
	const { data: team, isLoading: isLoadingTeam } = useQuery({
		queryKey: queryKeys.teams.detail(teamId),
		queryFn: async () => {
			const result = await getTeam(teamId);
			if (!result.success) {
				throw new Error(result.error || "Failed to load team");
			}
			return result.data;
		},
	});

	// Load current employee on mount
	useEffect(() => {
		async function loadCurrentEmployee() {
			const current = await getCurrentEmployee();
			if (!current) {
				setNoEmployee(true);
				return;
			}
			setCurrentEmployee(current);
		}
		loadCurrentEmployee();
	}, []);

	// Update form and permissions when team data changes
	useEffect(() => {
		if (team && currentEmployee) {
			form.setFieldValue("name", team.name);
			form.setFieldValue("description", team.description || "");
			const isAdmin = currentEmployee.role === "admin";
			setCanManageSettings((team as any).canManageSettings || isAdmin);
			setCanManageMembers((team as any).canManageMembers || isAdmin);
		}
	}, [team, currentEmployee, form]);

	async function loadAvailableEmployees() {
		if (!team) return;

		const result = await listEmployees({ limit: 1000 });
		if (result.success && result.data) {
			// Filter out employees already in the team
			const teamMemberIds = new Set((team as any).employees?.map((e: any) => e.id) || []);
			const available = result.data.employees.filter((emp) => !teamMemberIds.has(emp.id));
			setAvailableEmployees(available);
		}
	}

	// Update team mutation
	const updateTeamMutation = useMutation({
		mutationFn: async (values: TeamFormValues) => {
			const result = await updateTeam(teamId, values);
			if (!result.success) {
				throw new Error(result.error || "Failed to update team");
			}
			return result;
		},
		onSuccess: () => {
			toast.success("Team updated successfully");
			setIsEditing(false);
			queryClient.invalidateQueries({ queryKey: queryKeys.teams.detail(teamId) });
			queryClient.invalidateQueries({ queryKey: queryKeys.teams.all });
		},
		onError: (error: Error) => {
			toast.error(error.message);
		},
	});

	// Add member mutation with optimistic update
	const addMemberMutation = useMutation({
		mutationFn: async (employeeId: string) => {
			const result = await addTeamMember(teamId, employeeId);
			if (!result.success) {
				throw new Error(result.error || "Failed to add team member");
			}
			return result;
		},
		onSuccess: () => {
			toast.success("Team member added successfully");
			setShowAddMember(false);
			setSelectedEmployee("");
			// Invalidate team queries to refresh the member list
			queryClient.invalidateQueries({ queryKey: queryKeys.teams.detail(teamId) });
			queryClient.invalidateQueries({ queryKey: queryKeys.teams.all });
			queryClient.invalidateQueries({ queryKey: queryKeys.employees.all });
		},
		onError: (error: Error) => {
			toast.error(error.message);
		},
	});

	// Remove member mutation with optimistic update
	const removeMemberMutation = useMutation({
		mutationFn: async (employeeId: string) => {
			const result = await removeTeamMember(teamId, employeeId);
			if (!result.success) {
				throw new Error(result.error || "Failed to remove team member");
			}
			return result;
		},
		onMutate: async (employeeId) => {
			// Cancel outgoing refetches
			await queryClient.cancelQueries({ queryKey: queryKeys.teams.detail(teamId) });

			// Snapshot previous value
			const previousTeam = queryClient.getQueryData(queryKeys.teams.detail(teamId));

			// Optimistically update to remove the member
			queryClient.setQueryData(queryKeys.teams.detail(teamId), (old: any) => {
				if (!old) return old;
				return {
					...old,
					employees: old.employees?.filter((e: any) => e.id !== employeeId) || [],
				};
			});

			return { previousTeam };
		},
		onSuccess: () => {
			toast.success("Team member removed successfully");
			setSelectedMemberToRemove(null);
			// Invalidate related queries
			queryClient.invalidateQueries({ queryKey: queryKeys.teams.all });
			queryClient.invalidateQueries({ queryKey: queryKeys.employees.all });
		},
		onError: (error: Error, _employeeId, context) => {
			// Rollback on error
			if (context?.previousTeam) {
				queryClient.setQueryData(queryKeys.teams.detail(teamId), context.previousTeam);
			}
			toast.error(error.message);
		},
		onSettled: () => {
			// Refetch to ensure we have the correct data
			queryClient.invalidateQueries({ queryKey: queryKeys.teams.detail(teamId) });
		},
	});

	// Delete team mutation
	const deleteTeamMutation = useMutation({
		mutationFn: async () => {
			const result = await deleteTeam(teamId);
			if (!result.success) {
				throw new Error(result.error || "Failed to delete team");
			}
			return result;
		},
		onSuccess: () => {
			toast.success("Team deleted successfully");
			queryClient.invalidateQueries({ queryKey: queryKeys.teams.all });
			router.push("/settings/teams");
		},
		onError: (error: Error) => {
			toast.error(error.message);
		},
		onSettled: () => {
			setShowDeleteDialog(false);
		},
	});

	function handleAddMember() {
		if (!selectedEmployee) {
			toast.error("Please select an employee");
			return;
		}
		addMemberMutation.mutate(selectedEmployee);
	}

	function handleRemoveMember(employeeId: string) {
		removeMemberMutation.mutate(employeeId);
	}

	function handleDeleteTeam() {
		deleteTeamMutation.mutate();
	}

	const loading =
		updateTeamMutation.isPending ||
		addMemberMutation.isPending ||
		removeMemberMutation.isPending ||
		deleteTeamMutation.isPending;

	if (noEmployee) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature="view teams" />
			</div>
		);
	}

	if (isLoadingTeam || !team) {
		return (
			<div className="flex flex-1 flex-col gap-4 p-4">
				<div className="flex items-center justify-center p-8">
					<IconLoader2 className="size-8 animate-spin text-muted-foreground" />
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
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
				{canManageSettings && (
					<div className="flex gap-2">
						<Button variant="destructive" size="sm" onClick={() => setShowDeleteDialog(true)}>
							<IconTrash className="mr-2 size-4" />
							Delete Team
						</Button>
					</div>
				)}
			</div>

			<div className="grid gap-4 lg:grid-cols-3">
				{/* Team Info Card */}
				<Card>
					<CardHeader>
						<div className="flex items-center justify-between">
							<CardTitle>Team Information</CardTitle>
							{canManageSettings && !isEditing && (
								<Button variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
									Edit
								</Button>
							)}
						</div>
					</CardHeader>
					<CardContent className="space-y-4">
						{isEditing ? (
							<form
								onSubmit={(e) => {
									e.preventDefault();
									form.handleSubmit();
								}}
								className="space-y-4"
							>
								<form.Field
									name="name"
									validators={{
										onChange: z
											.string()
											.min(1, "Team name is required")
											.max(100, "Team name is too long"),
									}}
								>
									{(field) => (
										<div className="space-y-2">
											<Label>Team Name</Label>
											<Input
												placeholder="Enter team name"
												value={field.state.value}
												onChange={(e) => field.handleChange(e.target.value)}
												onBlur={field.handleBlur}
											/>
											{field.state.meta.errors.length > 0 && (
												<p className="text-sm text-destructive">
													{typeof field.state.meta.errors[0] === "string"
														? field.state.meta.errors[0]
														: (field.state.meta.errors[0] as any)?.message || "Invalid input"}
												</p>
											)}
										</div>
									)}
								</form.Field>

								<form.Field name="description">
									{(field) => (
										<div className="space-y-2">
											<Label>Description</Label>
											<Textarea
												placeholder="Enter team description"
												value={field.state.value}
												onChange={(e) => field.handleChange(e.target.value)}
												onBlur={field.handleBlur}
											/>
											{field.state.meta.errors.length > 0 && (
												<p className="text-sm text-destructive">
													{typeof field.state.meta.errors[0] === "string"
														? field.state.meta.errors[0]
														: (field.state.meta.errors[0] as any)?.message || "Invalid input"}
												</p>
											)}
										</div>
									)}
								</form.Field>

								<div className="flex justify-end gap-2">
									<Button
										type="button"
										variant="outline"
										size="sm"
										onClick={() => {
											setIsEditing(false);
											form.setFieldValue("name", team.name);
											form.setFieldValue("description", team.description || "");
										}}
										disabled={loading}
									>
										<IconX className="mr-2 size-4" />
										Cancel
									</Button>
									<Button type="submit" size="sm" disabled={loading}>
										{loading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
										<IconCheck className="mr-2 size-4" />
										Save
									</Button>
								</div>
							</form>
						) : (
							<>
								<div className="space-y-2">
									<div className="text-sm text-muted-foreground">Team Name</div>
									<div className="font-medium">{team.name}</div>
								</div>

								{team.description && (
									<>
										<Separator />
										<div className="space-y-2">
											<div className="text-sm text-muted-foreground">Description</div>
											<div className="text-sm">{team.description}</div>
										</div>
									</>
								)}

								<Separator />

								<div className="space-y-2">
									<div className="text-sm text-muted-foreground">Members</div>
									<div className="flex items-center gap-2">
										<IconUsers className="size-4 text-muted-foreground" />
										<span className="font-medium">{(team as any).employees?.length || 0}</span>
									</div>
								</div>
							</>
						)}
					</CardContent>
				</Card>

				{/* Members List */}
				<Card className="lg:col-span-2">
					<CardHeader>
						<div className="flex items-center justify-between">
							<div>
								<CardTitle>Team Members</CardTitle>
								<CardDescription>Employees assigned to this team</CardDescription>
							</div>
							{canManageMembers && (
								<Button
									size="sm"
									onClick={() => {
										loadAvailableEmployees();
										setShowAddMember(true);
									}}
								>
									<IconPlus className="mr-2 size-4" />
									Add Member
								</Button>
							)}
						</div>
					</CardHeader>
					<CardContent>
						{!(team as any).employees || (team as any).employees.length === 0 ? (
							<div className="flex flex-col items-center justify-center py-8">
								<IconUsers className="mb-4 size-12 text-muted-foreground" />
								<p className="text-sm text-muted-foreground">No members in this team</p>
							</div>
						) : (
							<div className="space-y-2">
								{(team as any).employees.map((emp: any) => (
									<div
										key={emp.id}
										className="flex items-center justify-between rounded-lg border p-3"
									>
										<div className="flex items-center gap-3">
											<UserAvatar
												image={emp.user.image}
												seed={emp.id}
												name={emp.user.name}
												size="md"
											/>
											<div>
												<div className="font-medium">{emp.user.name}</div>
												<div className="text-sm text-muted-foreground">{emp.user.email}</div>
											</div>
											{emp.position && <Badge variant="secondary">{emp.position}</Badge>}
										</div>
										{canManageMembers && (
											<Button
												variant="ghost"
												size="sm"
												onClick={() => setSelectedMemberToRemove(emp.id)}
											>
												<IconUserMinus className="size-4" />
											</Button>
										)}
									</div>
								))}
							</div>
						)}
					</CardContent>
				</Card>
			</div>

			{/* Add Member Dialog */}
			<Dialog open={showAddMember} onOpenChange={setShowAddMember}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Add Team Member</DialogTitle>
						<DialogDescription>Select an employee to add to this team</DialogDescription>
					</DialogHeader>
					<div className="space-y-4 py-4">
						<Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
							<SelectTrigger>
								<SelectValue placeholder="Select employee" />
							</SelectTrigger>
							<SelectContent>
								{availableEmployees.map((emp) => (
									<SelectItem key={emp.id} value={emp.id}>
										<div className="flex items-center gap-2">
											<span>{emp.user.name}</span>
											<span className="text-sm text-muted-foreground">({emp.user.email})</span>
										</div>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => {
								setShowAddMember(false);
								setSelectedEmployee("");
							}}
							disabled={loading}
						>
							Cancel
						</Button>
						<Button onClick={handleAddMember} disabled={loading}>
							{loading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
							Add Member
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Remove Member Confirmation */}
			<Dialog
				open={!!selectedMemberToRemove}
				onOpenChange={(open) => !open && setSelectedMemberToRemove(null)}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Remove Team Member</DialogTitle>
						<DialogDescription>
							Are you sure you want to remove this employee from the team? They will still have
							access to the organization.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setSelectedMemberToRemove(null)}
							disabled={loading}
						>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={() => selectedMemberToRemove && handleRemoveMember(selectedMemberToRemove)}
							disabled={loading}
						>
							{loading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
							Remove
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Delete Team Confirmation */}
			<Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete Team</DialogTitle>
						<DialogDescription>
							Are you sure you want to delete this team? This action cannot be undone. Team members
							will not be deleted.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setShowDeleteDialog(false)} disabled={loading}>
							Cancel
						</Button>
						<Button variant="destructive" onClick={handleDeleteTeam} disabled={loading}>
							{loading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
							Delete Team
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
