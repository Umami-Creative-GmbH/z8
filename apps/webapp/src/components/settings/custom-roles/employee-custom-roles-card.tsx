"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	IconLoader2,
	IconPlus,
	IconX,
} from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

import {
	listCustomRoles,
	getEmployeeCustomRoles,
	assignRoleToEmployee,
	unassignRoleFromEmployee,
	type CustomRoleWithPermissions,
} from "@/app/[locale]/(app)/settings/roles/actions";

interface EmployeeCustomRolesCardProps {
	employeeId: string;
	organizationId: string;
	isAdmin: boolean;
}

export function EmployeeCustomRolesCard({
	employeeId,
	organizationId,
	isAdmin,
}: EmployeeCustomRolesCardProps) {
	const queryClient = useQueryClient();
	const [isAssignOpen, setIsAssignOpen] = useState(false);

	const { data: assignedRoles, isLoading: isLoadingAssigned } = useQuery({
		queryKey: ["employee-custom-roles", employeeId],
		queryFn: async () => {
			const result = await getEmployeeCustomRoles(employeeId);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});

	const { data: allRoles } = useQuery({
		queryKey: ["custom-roles", organizationId],
		queryFn: async () => {
			const result = await listCustomRoles();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: isAssignOpen,
	});

	const assignMutation = useMutation({
		mutationFn: async (roleId: string) => {
			const result = await assignRoleToEmployee(employeeId, roleId);
			if (!result.success) throw new Error(result.error);
		},
		onSuccess: () => {
			toast.success("Role assigned");
			queryClient.invalidateQueries({
				queryKey: ["employee-custom-roles", employeeId],
			});
			setIsAssignOpen(false);
		},
		onError: (err: Error) => toast.error(err.message),
	});

	const unassignMutation = useMutation({
		mutationFn: async (roleId: string) => {
			const result = await unassignRoleFromEmployee(employeeId, roleId);
			if (!result.success) throw new Error(result.error);
		},
		onSuccess: () => {
			toast.success("Role removed");
			queryClient.invalidateQueries({
				queryKey: ["employee-custom-roles", employeeId],
			});
		},
		onError: (err: Error) => toast.error(err.message),
	});

	const assignedIds = new Set(assignedRoles?.map((r) => r.id) ?? []);
	const availableRoles = allRoles?.filter((r) => !assignedIds.has(r.id)) ?? [];

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<div>
						<CardTitle>Custom Roles</CardTitle>
						<CardDescription>
							Additional permission roles assigned to this employee
						</CardDescription>
					</div>
					{isAdmin && (
						<Button
							variant="outline"
							size="sm"
							onClick={() => setIsAssignOpen(true)}
						>
							<IconPlus className="mr-1 h-4 w-4" />
							Assign Role
						</Button>
					)}
				</div>
			</CardHeader>
			<CardContent>
				{isLoadingAssigned ? (
					<div className="flex items-center justify-center py-4">
						<IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
					</div>
				) : !assignedRoles?.length ? (
					<p className="text-sm text-muted-foreground">
						No custom roles assigned.
					</p>
				) : (
					<div className="flex flex-wrap gap-2">
						{assignedRoles.map((role) => (
							<Badge
								key={role.id}
								variant="secondary"
								className="gap-1 py-1 pl-2 pr-1"
								style={{
									borderColor: role.color,
									borderWidth: "1px",
								}}
							>
								<span
									className="mr-1 inline-block h-2 w-2 rounded-full"
									style={{ backgroundColor: role.color }}
								/>
								{role.name}
								<span className="text-xs text-muted-foreground ml-1">
									({role.permissions.length} perm
									{role.permissions.length !== 1 ? "s" : ""})
								</span>
								{isAdmin && (
									<button
										type="button"
										aria-label={`Remove ${role.name}`}
										className="ml-1 rounded-full p-0.5 hover:bg-muted"
										onClick={() => unassignMutation.mutate(role.id)}
										disabled={unassignMutation.isPending}
									>
										<IconX className="h-3 w-3" />
									</button>
								)}
							</Badge>
						))}
					</div>
				)}
			</CardContent>

			{/* Assign Role Dialog */}
			<Dialog open={isAssignOpen} onOpenChange={setIsAssignOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Assign Custom Role</DialogTitle>
						<DialogDescription>
							Select a role to assign to this employee.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-2">
						{!availableRoles.length ? (
							<p className="text-sm text-muted-foreground py-4 text-center">
								No available roles to assign. All roles are already assigned
								or none have been created.
							</p>
						) : (
							availableRoles.map((role) => (
								<button
									key={role.id}
									type="button"
									className="flex w-full items-center gap-3 rounded-md border p-3 hover:bg-muted/50 text-left"
									onClick={() => assignMutation.mutate(role.id)}
									disabled={assignMutation.isPending}
								>
									<div
										className="h-3 w-3 rounded-full shrink-0"
										style={{ backgroundColor: role.color }}
									/>
									<div className="flex-1">
										<div className="font-medium text-sm">{role.name}</div>
										{role.description && (
											<div className="text-xs text-muted-foreground">
												{role.description}
											</div>
										)}
									</div>
									<Badge variant="outline" className="text-xs">
										{role.permissions.length} perms
									</Badge>
								</button>
							))
						)}
					</div>
				</DialogContent>
			</Dialog>
		</Card>
	);
}
