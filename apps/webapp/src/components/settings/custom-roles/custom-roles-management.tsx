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
import { DeleteConfirmDialog } from "@/components/settings/delete-confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type { CustomRoleWithPermissions } from "@/lib/effect/services/custom-role.service";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
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
		isError,
		error,
		isFetching,
		refetch,
	} = useQuery({
		queryKey: ["custom-roles", organizationId],
		queryFn: async () => {
			const result = await listCustomRoles();
			if (!result.success) throw new Error(actionErrorMessage(t, result));
			return result.data;
		},
	});

	const deleteMutation = useMutation({
		mutationFn: async (roleId: string) => {
			const result = await deleteCustomRole({ roleId });
			if (!result.success) throw new Error(actionErrorMessage(t, result));
		},
		onSuccess: () => {
			toast.success(t("settings.roles.toast.deleted", "Role deleted"));
			queryClient.invalidateQueries({ queryKey: ["custom-roles"] });
			setDeleteTarget(null);
		},
		// A failure is shown inside the confirmation dialog, which stays open for a retry.
	});

	const requestDelete = (role: CustomRoleWithPermissions) => {
		if (deleteMutation.isPending) return;
		deleteMutation.reset();
		setDeleteTarget(role);
	};

	const handleSaved = () => {
		queryClient.invalidateQueries({ queryKey: ["custom-roles"] });
		setIsCreateOpen(false);
		setEditingRole(null);
	};

	return (
		<div className="page-frame">
			<div className="page-measure space-y-6">
			<PageHeader
				title={t("settings.roles.title", "Custom Roles")}
				description={t(
					"settings.roles.introduction",
					"Create custom permission roles that can be assigned to employees. Custom roles add permissions on top of the base tier.",
				)}
				actions={
					<>
						<Button
							variant="ghost"
							size="icon"
							onClick={() => refetch()}
							disabled={isFetching}
							aria-label={t("settings.roles.actions.refresh", "Refresh custom roles")}
						>
							<IconRefresh
								className={`size-4 ${isFetching ? "motion-safe:animate-spin" : ""}`}
								aria-hidden="true"
							/>
						</Button>
						<Button onClick={() => setIsCreateOpen(true)}>
							<IconPlus className="mr-2 size-4" aria-hidden="true" />
							{t("settings.roles.actions.create", "Create Role")}
						</Button>
					</>
				}
			/>

			{isLoading ? (
				<Card>
					<CardContent
						className="flex items-center justify-center py-12"
						role="status"
						aria-label={t("common.loadingRegions.customRoleSettings", "Loading custom role settings")}
					>
						<IconLoader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
					</CardContent>
				</Card>
			) : isError ? (
				<div
					role="alert"
					className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4"
				>
					<p className="text-sm">
						{error?.message ||
							t("settings.roles.loadFailed", "Custom roles could not be loaded.")}
					</p>
					<Button variant="outline" onClick={() => void refetch()} disabled={isFetching}>
						{t("common.retry", "Try again")}
					</Button>
				</div>
			) : !roles?.length ? (
				<Card>
					<CardContent className="flex flex-col items-start gap-3 py-8 sm:items-center sm:text-center">
						<IconShieldCog className="size-8 text-muted-foreground" aria-hidden="true" />
						<div className="space-y-1">
							<h2 className="text-base font-medium">
								{t("settings.roles.empty.title", "No custom roles yet")}
							</h2>
							<p className="text-sm text-muted-foreground">
								{t("settings.roles.empty.description", "Create one to get started.")}
							</p>
						</div>
						<Button onClick={() => setIsCreateOpen(true)}>
							<IconPlus className="mr-2 size-4" aria-hidden="true" />
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
										<TableCell className="max-w-xs">
											<div className="flex min-w-0 items-center gap-2">
												<div
													aria-hidden="true"
													className="size-3 shrink-0 rounded-full"
													style={{ backgroundColor: role.color }}
												/>
												<div className="min-w-0">
													<div className="truncate font-medium" title={role.name}>
														{role.name}
													</div>
													{role.description && (
														<div
															className="line-clamp-2 text-xs text-muted-foreground"
															title={role.description}
														>
															{role.description}
														</div>
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
										<TableCell className="tabular-nums">
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
													<IconEdit className="size-4" aria-hidden="true" />
												</Button>
												<Button
													variant="ghost"
													size="icon"
													aria-label={t("settings.roles.actions.deleteNamed", "Delete {name}", {
														name: role.name,
													})}
													onClick={() => requestDelete(role)}
												>
													<IconTrash className="size-4" aria-hidden="true" />
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
			<DeleteConfirmDialog
				open={!!deleteTarget}
				onOpenChange={(open) => {
					if (!open) setDeleteTarget(null);
				}}
				title={t("settings.roles.deleteDialog.title", "Delete Role")}
				description={
					<>
						{t("settings.roles.deleteDialog.confirm", 'Are you sure you want to delete "{name}"?', {
							name: deleteTarget?.name ?? "",
						})}
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
					</>
				}
				confirmLabel={t("settings.roles.deleteDialog.confirmAction", "Delete role")}
				isDeleting={deleteMutation.isPending}
				error={deleteMutation.error?.message ?? null}
				onConfirm={() => {
					if (deleteTarget && !deleteMutation.isPending) deleteMutation.mutate(deleteTarget.id);
				}}
			/>
			</div>
		</div>
	);
}
