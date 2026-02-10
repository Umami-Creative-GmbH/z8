"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	IconEdit,
	IconLoader2,
	IconPlus,
	IconTrash,
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
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

import {
	listCustomRoles,
	deleteCustomRole,
} from "@/app/[locale]/(app)/settings/roles/actions";
import type { CustomRoleWithPermissions } from "@/lib/effect/services/custom-role.service";
import { RoleEditor } from "./role-editor";

const TIER_LABELS: Record<string, string> = {
	admin: "Admin",
	manager: "Manager",
	employee: "Employee",
};

const TIER_VARIANTS: Record<string, "default" | "secondary" | "outline"> = {
	admin: "default",
	manager: "secondary",
	employee: "outline",
};

interface CustomRolesManagementProps {
	organizationId: string;
}

export function CustomRolesManagement({ organizationId }: CustomRolesManagementProps) {
	const queryClient = useQueryClient();
	const [editingRole, setEditingRole] = useState<CustomRoleWithPermissions | null>(null);
	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const [deleteTarget, setDeleteTarget] = useState<CustomRoleWithPermissions | null>(null);

	const { data: roles, isLoading } = useQuery({
		queryKey: ["custom-roles", organizationId],
		queryFn: async () => {
			const result = await listCustomRoles();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});

	const deleteMutation = useMutation({
		mutationFn: async (roleId: string) => {
			const result = await deleteCustomRole(roleId);
			if (!result.success) throw new Error(result.error);
		},
		onSuccess: () => {
			toast.success("Role deleted");
			queryClient.invalidateQueries({ queryKey: ["custom-roles"] });
			setDeleteTarget(null);
		},
		onError: (err: Error) => {
			toast.error(err.message);
		},
	});

	const handleSaved = () => {
		queryClient.invalidateQueries({ queryKey: ["custom-roles"] });
		setIsCreateOpen(false);
		setEditingRole(null);
	};

	return (
		<div className="space-y-6">
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<CardTitle>Custom Roles</CardTitle>
							<CardDescription>
								Create custom permission roles that can be assigned to employees.
								Custom roles add permissions on top of the base tier.
							</CardDescription>
						</div>
						<Button onClick={() => setIsCreateOpen(true)}>
							<IconPlus className="mr-2 h-4 w-4" />
							Create Role
						</Button>
					</div>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<div className="flex items-center justify-center py-8">
							<IconLoader2 className="h-6 w-6 animate-spin text-muted-foreground" />
						</div>
					) : !roles?.length ? (
						<div className="py-8 text-center text-muted-foreground">
							No custom roles yet. Create one to get started.
						</div>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Name</TableHead>
									<TableHead>Base Tier</TableHead>
									<TableHead>Permissions</TableHead>
									<TableHead>Assigned</TableHead>
									<TableHead className="w-[100px]">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{roles.map((role) => (
									<TableRow key={role.id}>
										<TableCell>
											<div className="flex items-center gap-2">
												<div
													className="h-3 w-3 rounded-full"
													style={{ backgroundColor: role.color }}
												/>
												<div>
													<div className="font-medium">{role.name}</div>
													{role.description && (
														<div className="text-xs text-muted-foreground">
															{role.description}
														</div>
													)}
												</div>
											</div>
										</TableCell>
										<TableCell>
											<Badge variant={TIER_VARIANTS[role.baseTier]}>
												{TIER_LABELS[role.baseTier]}
											</Badge>
										</TableCell>
										<TableCell>
											<Badge variant="outline">
												{role.permissions.length} permission
												{role.permissions.length !== 1 ? "s" : ""}
											</Badge>
										</TableCell>
										<TableCell>
											{role.assignedCount} employee
											{role.assignedCount !== 1 ? "s" : ""}
										</TableCell>
										<TableCell>
											<div className="flex gap-1">
												<Button
													variant="ghost"
													size="icon"
													aria-label={`Edit ${role.name}`}
													onClick={() => setEditingRole(role)}
												>
													<IconEdit className="h-4 w-4" />
												</Button>
												<Button
													variant="ghost"
													size="icon"
													aria-label={`Delete ${role.name}`}
													onClick={() => setDeleteTarget(role)}
												>
													<IconTrash className="h-4 w-4" />
												</Button>
											</div>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			{/* Create Dialog */}
			<Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
				<DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>Create Custom Role</DialogTitle>
						<DialogDescription>
							Define a new role with specific permissions for your organization.
						</DialogDescription>
					</DialogHeader>
					<RoleEditor onSaved={handleSaved} onCancel={() => setIsCreateOpen(false)} />
				</DialogContent>
			</Dialog>

			{/* Edit Dialog */}
			<Dialog
				open={!!editingRole}
				onOpenChange={(open) => !open && setEditingRole(null)}
			>
				<DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>Edit Custom Role</DialogTitle>
						<DialogDescription>
							Update the role details and permissions.
						</DialogDescription>
					</DialogHeader>
					{editingRole && (
						<RoleEditor
							role={editingRole}
							onSaved={handleSaved}
							onCancel={() => setEditingRole(null)}
						/>
					)}
				</DialogContent>
			</Dialog>

			{/* Delete Confirmation Dialog */}
			<Dialog
				open={!!deleteTarget}
				onOpenChange={(open) => !open && setDeleteTarget(null)}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete Role</DialogTitle>
						<DialogDescription>
							Are you sure you want to delete &quot;{deleteTarget?.name}&quot;?
							{deleteTarget && deleteTarget.assignedCount > 0 && (
								<span className="block mt-1 text-destructive">
									This role is currently assigned to {deleteTarget.assignedCount}{" "}
									employee{deleteTarget.assignedCount !== 1 ? "s" : ""}. They will
									lose the permissions granted by this role.
								</span>
							)}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setDeleteTarget(null)}
						>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
							disabled={deleteMutation.isPending}
						>
							{deleteMutation.isPending && (
								<IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
							)}
							Delete
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
