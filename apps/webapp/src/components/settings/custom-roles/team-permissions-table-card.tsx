"use client";

import { IconLoader2, IconUserCog } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import type { SelectableEmployee } from "@/app/[locale]/(app)/settings/employees/employee-action-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { UserAvatar } from "@/components/user-avatar";
import { useEmployeeClockStatuses } from "@/lib/query";

type Translate = ReturnType<typeof useTranslate>["t"];

/** Base roles are stored as codes; each label is a static literal for extraction. */
function roleLabel(role: string, t: Translate) {
	switch (role) {
		case "admin":
			return t("settings.permissions.roles.admin", "Admin");
		case "manager":
			return t("settings.permissions.roles.manager", "Manager");
		case "employee":
			return t("settings.permissions.roles.employee", "Employee");
		default:
			return role;
	}
}

function scopeLabel(scope: "team" | "organization", t: Translate) {
	return scope === "team"
		? t("settings.permissions.scope.team", "Team-specific")
		: t("settings.permissions.scope.organization", "Organization-wide");
}

export function TeamPermissionsTableCard(props: {
	loading: boolean;
	/** The employee list failed to load: shown as an error with retry, not as "no employees". */
	loadFailed?: boolean;
	searchQuery: string;
	onSearchChange: (value: string) => void;
	onRefresh: () => void;
	employees: SelectableEmployee[];
	onEdit: (employee: SelectableEmployee) => void;
	getSummary: (employeeId: string) => { count: number; scope: "team" | "organization" } | null;
}) {
	const { t } = useTranslate();
	const {
		loading,
		loadFailed = false,
		searchQuery,
		onSearchChange,
		onRefresh,
		employees,
		onEdit,
		getSummary,
	} = props;
	const presence = useEmployeeClockStatuses(
		employees.map((employee) => employee.id),
		{ polling: false },
	);

	return (
		<Card>
			<CardHeader>
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="min-w-0">
						<CardTitle>
							{t("settings.permissions.employeePermissions.title", "Employee Permissions")}
						</CardTitle>
						<CardDescription>
							{t(
								"settings.permissions.employeePermissions.editHint",
								"Choose Edit next to an employee to change their team permissions.",
							)}
						</CardDescription>
					</div>
					<Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
						{loading ? (
							<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
						) : null}
						{t("settings.permissions.refresh", "Refresh")}
					</Button>
				</div>
			</CardHeader>
			<CardContent>
				<div className="space-y-4">
					<Input
						type="search"
						aria-label={t("settings.permissions.searchLabel", "Search employees")}
						placeholder={t(
							"settings.permissions.searchPlaceholder",
							"Search by name, email, or position...",
						)}
						value={searchQuery}
						onChange={(event) => onSearchChange(event.target.value)}
						className="max-w-sm"
					/>

					{loading ? (
						<div
							className="flex items-center justify-center py-8"
							role="status"
							aria-label={t("settings.permissions.loading", "Loading employee permissions")}
						>
							<IconLoader2
								className="size-8 animate-spin text-muted-foreground"
								aria-hidden="true"
							/>
						</div>
					) : loadFailed ? (
						<div
							role="alert"
							className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4"
						>
							<p className="text-sm">
								{t("settings.permissions.loadFailed", "Employee permissions could not be loaded.")}
							</p>
							<Button variant="outline" size="sm" onClick={onRefresh}>
								{t("common.retry", "Try again")}
							</Button>
						</div>
					) : employees.length === 0 ? (
						<div className="flex flex-col items-start gap-2 py-6 sm:items-center sm:text-center">
							<IconUserCog className="size-8 text-muted-foreground" aria-hidden="true" />
							<p className="text-sm text-muted-foreground">
								{t("settings.permissions.emptyState", "No employees found")}
							</p>
						</div>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>{t("settings.permissions.table.employee", "Employee")}</TableHead>
									<TableHead>{t("settings.permissions.table.position", "Position")}</TableHead>
									<TableHead>{t("settings.permissions.table.role", "Role")}</TableHead>
									<TableHead>
										{t("settings.permissions.table.permissions", "Permissions")}
									</TableHead>
									<TableHead className="text-right">
										{t("settings.permissions.table.actions", "Actions")}
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{employees.map((employee) => {
									const permissionSummary = getSummary(employee.id);

									return (
										<TableRow key={employee.id}>
											<TableCell className="max-w-xs">
												<div className="flex min-w-0 items-center gap-3">
													<UserAvatar
														image={employee.user.image}
														seed={employee.id}
														name={employee.user.name}
														size="sm"
														clockStatus={presence.getStatus(employee.id)}
													/>
													<div className="min-w-0">
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
												</div>
											</TableCell>
											<TableCell>
												<span className="text-sm">{employee.position || "—"}</span>
											</TableCell>
											<TableCell>
												<Badge variant={employee.role === "admin" ? "default" : "secondary"}>
													{roleLabel(employee.role, t)}
												</Badge>
											</TableCell>
											<TableCell>
												{employee.role === "admin" ? (
													<Badge variant="default">
														{t("settings.permissions.badge.allPermissions", "All Permissions")}
													</Badge>
												) : permissionSummary ? (
													<div className="flex flex-wrap gap-2">
														<Badge variant="secondary" className="tabular-nums">
															{t(
																"settings.permissions.badge.permissionCount",
																"{count} permission(s)",
																{
																	count: permissionSummary.count,
																},
															)}
														</Badge>
														<Badge variant="outline">
															{scopeLabel(permissionSummary.scope, t)}
														</Badge>
													</div>
												) : (
													<span className="text-sm text-muted-foreground">
														{t("settings.permissions.noPermissions", "No permissions")}
													</span>
												)}
											</TableCell>
											<TableCell className="text-right">
												{employee.role === "admin" ? (
													// Admins already hold every permission; there is nothing to edit.
													<span className="text-sm text-muted-foreground">—</span>
												) : (
													<Button
														variant="ghost"
														size="sm"
														onClick={() => onEdit(employee)}
														aria-label={t(
															"settings.permissions.actions.editNamed",
															"Edit permissions for {name}",
															{ name: employee.user.name },
														)}
													>
														{t("settings.permissions.actions.edit", "Edit")}
													</Button>
												)}
											</TableCell>
										</TableRow>
									);
								})}
							</TableBody>
						</Table>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
