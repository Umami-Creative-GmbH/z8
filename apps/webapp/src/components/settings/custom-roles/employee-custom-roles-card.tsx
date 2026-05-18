"use client";

import { IconLoader2, IconPlus, IconX } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	assignRoleToEmployee,
	getEmployeeCustomRoles,
	listCustomRoles,
	unassignRoleFromEmployee,
} from "@/app/[locale]/(app)/settings/roles/actions";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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
	const { t } = useTranslate();
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
			toast.success(t("settings.roles.toast.assigned", "Role assigned"));
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
			toast.success(t("settings.roles.toast.removed", "Role removed"));
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
						<CardTitle>{t("settings.roles.title", "Custom Roles")}</CardTitle>
						<CardDescription>
							{t(
								"settings.roles.employeeCard.description",
								"Additional permission roles assigned to this employee",
							)}
						</CardDescription>
					</div>
					{isAdmin && (
						<Button variant="outline" size="sm" onClick={() => setIsAssignOpen(true)}>
							<IconPlus className="mr-1 size-4" />
							{t("settings.roles.actions.assign", "Assign Role")}
						</Button>
					)}
				</div>
			</CardHeader>
			<CardContent>
				{isLoadingAssigned ? (
					<div className="flex items-center justify-center py-4">
						<IconLoader2 className="size-5 animate-spin text-muted-foreground" />
					</div>
				) : !assignedRoles?.length ? (
					<p className="text-sm text-muted-foreground">
						{t("settings.roles.employeeCard.empty", "No custom roles assigned.")}
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
									className="mr-1 inline-block size-2 rounded-full"
									style={{ backgroundColor: role.color }}
								/>
								{role.name}
								<span className="text-xs text-muted-foreground ml-1">
									{role.permissions.length === 1
										? t("settings.roles.employeeCard.permissionCount.one", "({count} perm)", {
												count: role.permissions.length,
											})
										: t("settings.roles.employeeCard.permissionCount.other", "({count} perms)", {
												count: role.permissions.length,
											})}
								</span>
								{isAdmin && (
									<button
										type="button"
										aria-label={t("settings.roles.actions.removeNamed", "Remove {name}", {
											name: role.name,
										})}
										className="ml-1 rounded-full p-0.5 hover:bg-muted"
										onClick={() => unassignMutation.mutate(role.id)}
										disabled={unassignMutation.isPending}
									>
										<IconX className="size-3" />
									</button>
								)}
							</Badge>
						))}
					</div>
				)}
			</CardContent>

			{/* Assign Role ActionPanel */}
			<ActionPanel open={isAssignOpen} onOpenChange={setIsAssignOpen}>
				<ActionPanelContent>
					<ActionPanelHeader>
						<ActionPanelTitle>
							{t("settings.roles.assignPanel.title", "Assign Custom Role")}
						</ActionPanelTitle>
						<ActionPanelDescription>
							{t(
								"settings.roles.assignPanel.description",
								"Select a role to assign to this employee.",
							)}
						</ActionPanelDescription>
					</ActionPanelHeader>
					<ActionPanelBody className="space-y-2">
						{!availableRoles.length ? (
							<p className="text-sm text-muted-foreground py-4 text-center">
								{t(
									"settings.roles.assignPanel.empty",
									"No available roles to assign. All roles are already assigned or none have been created.",
								)}
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
										className="size-3 rounded-full shrink-0"
										style={{ backgroundColor: role.color }}
									/>
									<div className="flex-1">
										<div className="font-medium text-sm">{role.name}</div>
										{role.description && (
											<div className="text-xs text-muted-foreground">{role.description}</div>
										)}
									</div>
									<Badge variant="outline" className="text-xs">
										{t("settings.roles.assignPanel.permissionCount", "{count} perms", {
											count: role.permissions.length,
										})}
									</Badge>
								</button>
							))
						)}
					</ActionPanelBody>
				</ActionPanelContent>
			</ActionPanel>
		</Card>
	);
}
