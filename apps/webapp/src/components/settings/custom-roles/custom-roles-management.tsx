"use client";

import {
	IconEdit,
	IconLoader2,
	IconPlus,
	IconRefresh,
	IconShieldCog,
	IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { deleteCustomRole, listCustomRoles } from "@/app/[locale]/(app)/settings/roles/actions";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type { CustomRoleWithPermissions } from "@/lib/effect/services/custom-role.service";
import { RoleEditor } from "./role-editor";

const TIER_VARIANTS: Record<string, "default" | "secondary" | "outline"> = {
	admin: "default",
	manager: "secondary",
	employee: "outline",
};

const TIER_LABEL_FALLBACKS: Record<string, string> = {
	admin: "Admin",
	manager: "Manager",
	employee: "Employee",
};

interface CustomRolesManagementProps {
	organizationId: string;
}

export function CustomRolesManagement({ organizationId }: CustomRolesManagementProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [editingRole, setEditingRole] = useState<CustomRoleWithPermissions | null>(null);
	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const [deleteTarget, setDeleteTarget] = useState<CustomRoleWithPermissions | null>(null);

	const {
		data: roles,
		isLoading,
		isFetching,
		refetch,
	} = useQuery({
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
			toast.success(t("settings.roles.toast.deleted", "Role deleted"));
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
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex items-center justify-between">
				<div className="flex flex-col gap-2">
					<h1 className="text-2xl font-semibold tracking-tight">
						{t("settings.roles.title", "Custom Roles")}
					</h1>
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.roles.introduction",
							"Create custom permission roles that can be assigned to employees. Custom roles add permissions on top of the base tier.",
						)}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isFetching}>
						<IconRefresh className={`size-4 ${isFetching ? "animate-spin" : ""}`} />
						<span className="sr-only">{t("common:actions.refresh", "Refresh")}</span>
					</Button>
					<Button onClick={() => setIsCreateOpen(true)}>
						<IconPlus className="mr-2 size-4" />
						{t("settings.roles.actions.create", "Create Role")}
					</Button>
				</div>
			</div>

			{isLoading ? (
				<Card>
					<CardContent className="flex items-center justify-center py-12">
						<IconLoader2 className="size-6 animate-spin text-muted-foreground" />
					</CardContent>
				</Card>
			) : !roles?.length ? (
				<Card>
					<CardContent className="flex flex-col items-center justify-center py-12">
						<IconShieldCog className="size-12 text-muted-foreground" />
						<h3 className="mt-4 text-lg font-medium">
							{t("settings.roles.empty.title", "No custom roles yet")}
						</h3>
						<p className="mt-2 text-sm text-muted-foreground">
							{t("settings.roles.empty.description", "Create one to get started.")}
						</p>
						<Button onClick={() => setIsCreateOpen(true)} className="mt-4">
							<IconPlus className="mr-2 size-4" />
							{t("settings.roles.actions.create", "Create Role")}
						</Button>
					</CardContent>
				</Card>
			) : (
				<Card>
					<CardContent>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>{t("settings.roles.table.name", "Name")}</TableHead>
									<TableHead>{t("settings.roles.table.baseTier", "Base Tier")}</TableHead>
									<TableHead>{t("settings.roles.table.permissions", "Permissions")}</TableHead>
									<TableHead>{t("settings.roles.table.assigned", "Assigned")}</TableHead>
									<TableHead className="w-[100px]">
										{t("settings.roles.table.actions", "Actions")}
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{roles.map((role) => (
									<TableRow key={role.id}>
										<TableCell>
											<div className="flex items-center gap-2">
												<div
													className="size-3 rounded-full"
													style={{ backgroundColor: role.color }}
												/>
												<div>
													<div className="font-medium">{role.name}</div>
													{role.description && (
														<div className="text-xs text-muted-foreground">{role.description}</div>
													)}
												</div>
											</div>
										</TableCell>
										<TableCell>
											<Badge variant={TIER_VARIANTS[role.baseTier]}>
												{t(
													`settings.roles.baseTiers.${role.baseTier}`,
													TIER_LABEL_FALLBACKS[role.baseTier] ?? role.baseTier,
												)}
											</Badge>
										</TableCell>
										<TableCell>
											<Badge variant="outline">
												{role.permissions.length === 1
													? t("settings.roles.table.permissionCount.one", "{count} permission", {
															count: role.permissions.length,
														})
													: t("settings.roles.table.permissionCount.other", "{count} permissions", {
															count: role.permissions.length,
														})}
											</Badge>
										</TableCell>
										<TableCell>
											{role.assignedCount === 1
												? t("settings.roles.table.assignedCount.one", "{count} employee", {
														count: role.assignedCount,
													})
												: t("settings.roles.table.assignedCount.other", "{count} employees", {
														count: role.assignedCount,
													})}
										</TableCell>
										<TableCell>
											<div className="flex gap-1">
												<Button
													variant="ghost"
													size="icon"
													aria-label={t("settings.roles.actions.editNamed", "Edit {name}", {
														name: role.name,
													})}
													onClick={() => setEditingRole(role)}
												>
													<IconEdit className="size-4" />
												</Button>
												<Button
													variant="ghost"
													size="icon"
													aria-label={t("settings.roles.actions.deleteNamed", "Delete {name}", {
														name: role.name,
													})}
													onClick={() => setDeleteTarget(role)}
												>
													<IconTrash className="size-4" />
												</Button>
											</div>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</CardContent>
				</Card>
			)}

			{/* Create ActionPanel */}
			<ActionPanel open={isCreateOpen} onOpenChange={setIsCreateOpen}>
				<ActionPanelContent size="wide">
					<ActionPanelHeader>
						<ActionPanelTitle>
							{t("settings.roles.createPanel.title", "Create Custom Role")}
						</ActionPanelTitle>
						<ActionPanelDescription>
							{t(
								"settings.roles.createPanel.description",
								"Define a new role with specific permissions for your organization.",
							)}
						</ActionPanelDescription>
					</ActionPanelHeader>
					<ActionPanelBody>
						<RoleEditor onSaved={handleSaved} onCancel={() => setIsCreateOpen(false)} />
					</ActionPanelBody>
				</ActionPanelContent>
			</ActionPanel>

			{/* Edit ActionPanel */}
			<ActionPanel open={!!editingRole} onOpenChange={(open) => !open && setEditingRole(null)}>
				<ActionPanelContent size="wide">
					<ActionPanelHeader>
						<ActionPanelTitle>
							{t("settings.roles.editPanel.title", "Edit Custom Role")}
						</ActionPanelTitle>
						<ActionPanelDescription>
							{t(
								"settings.roles.editPanel.description",
								"Update the role details and permissions.",
							)}
						</ActionPanelDescription>
					</ActionPanelHeader>
					<ActionPanelBody>
						{editingRole && (
							<RoleEditor
								role={editingRole}
								onSaved={handleSaved}
								onCancel={() => setEditingRole(null)}
							/>
						)}
					</ActionPanelBody>
				</ActionPanelContent>
			</ActionPanel>

			{/* Delete confirmation */}
			<AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("settings.roles.deleteDialog.title", "Delete Role")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.roles.deleteDialog.confirm",
								'Are you sure you want to delete "{name}"?',
								{
									name: deleteTarget?.name ?? "",
								},
							)}
							{deleteTarget && deleteTarget.assignedCount > 0 && (
								<span className="block mt-1 text-destructive">
									{deleteTarget.assignedCount === 1
										? t(
												"settings.roles.deleteDialog.assignedWarning.one",
												"This role is currently assigned to {count} employee. They will lose the permissions granted by this role.",
												{ count: deleteTarget.assignedCount },
											)
										: t(
												"settings.roles.deleteDialog.assignedWarning.other",
												"This role is currently assigned to {count} employees. They will lose the permissions granted by this role.",
												{ count: deleteTarget.assignedCount },
											)}
								</span>
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel onClick={() => setDeleteTarget(null)}>
							{t("common:actions.cancel", "Cancel")}
						</AlertDialogCancel>
						<AlertDialogAction asChild>
							<Button
								variant="destructive"
								onClick={(event) => {
									event.preventDefault();
									if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
								}}
								disabled={deleteMutation.isPending}
							>
								{deleteMutation.isPending && <IconLoader2 className="mr-2 size-4 animate-spin" />}
								{t("common:actions.delete", "Delete")}
							</Button>
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
