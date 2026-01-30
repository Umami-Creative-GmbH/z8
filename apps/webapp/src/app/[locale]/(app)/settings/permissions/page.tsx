"use client";

import { IconLoader2, IconShield, IconUserCog } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getCurrentEmployee } from "@/app/[locale]/(app)/approvals/actions";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { PermissionEditor } from "@/components/settings/permission-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import type { EmployeePermissions } from "@/lib/effect/services/permissions.service";
import { type EmployeeWithRelations, listEmployees } from "../employees/actions";
import { listTeams } from "../teams/actions";
import { listEmployeePermissions } from "./actions";

type TeamItem = { id: string; name: string };

export default function PermissionsPage() {
	const { t } = useTranslate();
	const [employees, setEmployees] = useState<EmployeeWithRelations[]>([]);
	const [teams, setTeams] = useState<TeamItem[]>([]);
	const [permissions, setPermissions] = useState<Record<string, EmployeePermissions>>({});
	const [loading, setLoading] = useState(true);
	const [currentEmployee, setCurrentEmployee] = useState<{
		id: string;
		role: string;
		organizationId: string;
	} | null>(null);
	const [noEmployee, setNoEmployee] = useState(false);
	const [isAdmin, setIsAdmin] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedEmployee, setSelectedEmployee] = useState<EmployeeWithRelations | null>(null);

	useEffect(() => {
		async function loadData() {
			const current = await getCurrentEmployee();
			if (!current) {
				setNoEmployee(true);
				return;
			}
			setCurrentEmployee(current);

			// Check if admin
			if (current.role !== "admin") {
				toast.error("You must be an admin to manage permissions");
				setNoEmployee(true);
				return;
			}
			setIsAdmin(true);

			// Load employees
			const empResult = await listEmployees({ limit: 1000 });
			if (empResult.success && empResult.data) {
				setEmployees(empResult.data.employees);
			} else if (!empResult.success) {
				toast.error(empResult.error || "Failed to load employees");
			}

			// Load teams
			const teamResult = await listTeams(current.organizationId);
			if (teamResult.success && teamResult.data) {
				setTeams(teamResult.data);
			}

			// Load permissions for all employees
			const permResult = await listEmployeePermissions(current.organizationId);
			if (permResult.success && permResult.data) {
				const permMap: Record<string, EmployeePermissions> = {};
				for (const item of permResult.data) {
					// The action returns an array of { employee, permissions }
					// We need to flatten permissions for display
					if (item.permissions.length > 0) {
						// Use the first permission entry (typically org-wide or team-specific)
						permMap[item.employee.id] = item.permissions[0];
					}
				}
				setPermissions(permMap);
			}

			setLoading(false);
		}

		loadData();
	}, []);

	async function handleRefresh() {
		if (!currentEmployee) return;

		setLoading(true);

		// Reload permissions
		const permResult = await listEmployeePermissions(currentEmployee.organizationId);
		if (permResult.success && permResult.data) {
			const permMap: Record<string, EmployeePermissions> = {};
			for (const item of permResult.data) {
				if (item.permissions.length > 0) {
					permMap[item.employee.id] = item.permissions[0];
				}
			}
			setPermissions(permMap);
		}

		// Reload employees
		const empResult = await listEmployees({ limit: 1000 });
		if (empResult.success && empResult.data) {
			setEmployees(empResult.data.employees);
		}

		setLoading(false);
	}

	const filteredEmployees = employees.filter((emp) => {
		if (!searchQuery) return true;
		const query = searchQuery.toLowerCase();
		return (
			emp.user.name.toLowerCase().includes(query) ||
			emp.user.email.toLowerCase().includes(query) ||
			emp.position?.toLowerCase().includes(query)
		);
	});

	const getPermissionSummary = (employeeId: string) => {
		const perm = permissions[employeeId];
		if (!perm) return null;

		const enabledCount = [
			perm.canCreateTeams,
			perm.canManageTeamMembers,
			perm.canManageTeamSettings,
			perm.canApproveTeamRequests,
		].filter(Boolean).length;

		if (enabledCount === 0) return null;

		return {
			count: enabledCount,
			scope: perm.teamId ? "Team-specific" : "Organization-wide",
		};
	};

	if (noEmployee) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature="manage permissions" />
			</div>
		);
	}

	if (!isAdmin) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<Card>
					<CardContent className="flex flex-col items-center justify-center py-8">
						<IconShield className="mb-4 size-12 text-muted-foreground" />
						<p className="text-sm text-muted-foreground">Admin access required</p>
					</CardContent>
				</Card>
			</div>
		);
	}

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight">
						{t("settings.permissions.title", "Team Permissions")}
					</h1>
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.permissions.description",
							"Manage employee permissions for team operations",
						)}
					</p>
				</div>
			</div>

			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<CardTitle>Employee Permissions</CardTitle>
							<CardDescription>Click on an employee to edit their permissions</CardDescription>
						</div>
						<Button variant="outline" size="sm" onClick={handleRefresh} disabled={loading}>
							{loading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
							Refresh
						</Button>
					</div>
				</CardHeader>
				<CardContent>
					<div className="space-y-4">
						{/* Search */}
						<Input
							placeholder="Search by name, email, or position..."
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							className="max-w-sm"
						/>

						{/* Employee Table */}
						{loading ? (
							<div className="flex items-center justify-center py-8">
								<IconLoader2 className="size-8 animate-spin text-muted-foreground" />
							</div>
						) : filteredEmployees.length === 0 ? (
							<div className="flex flex-col items-center justify-center py-8">
								<IconUserCog className="mb-4 size-12 text-muted-foreground" />
								<p className="text-sm text-muted-foreground">No employees found</p>
							</div>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Employee</TableHead>
										<TableHead>Position</TableHead>
										<TableHead>Role</TableHead>
										<TableHead>Permissions</TableHead>
										<TableHead className="text-right">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{filteredEmployees.map((emp) => {
										const permSummary = getPermissionSummary(emp.id);

										return (
											<TableRow key={emp.id}>
												<TableCell>
													<div className="flex items-center gap-3">
														<UserAvatar
															image={emp.user.image}
															seed={emp.id}
															name={emp.user.name}
															size="sm"
														/>
														<div>
															<div className="font-medium">{emp.user.name}</div>
															<div className="text-sm text-muted-foreground">{emp.user.email}</div>
														</div>
													</div>
												</TableCell>
												<TableCell>
													<span className="text-sm">{emp.position || "—"}</span>
												</TableCell>
												<TableCell>
													<Badge variant={emp.role === "admin" ? "default" : "secondary"}>
														{emp.role}
													</Badge>
												</TableCell>
												<TableCell>
													{emp.role === "admin" ? (
														<Badge variant="default">All Permissions</Badge>
													) : permSummary ? (
														<div className="flex gap-2">
															<Badge variant="secondary">
																{permSummary.count} permission
																{permSummary.count !== 1 ? "s" : ""}
															</Badge>
															<Badge variant="outline">{permSummary.scope}</Badge>
														</div>
													) : (
														<span className="text-sm text-muted-foreground">No permissions</span>
													)}
												</TableCell>
												<TableCell className="text-right">
													<Button
														variant="ghost"
														size="sm"
														onClick={() => setSelectedEmployee(emp)}
														disabled={emp.role === "admin"}
													>
														{emp.role === "admin" ? "—" : "Edit"}
													</Button>
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

			{/* Permission Editor Dialog */}
			<Dialog open={!!selectedEmployee} onOpenChange={(open) => !open && setSelectedEmployee(null)}>
				<DialogContent className="max-w-2xl">
					<DialogHeader>
						<DialogTitle>Edit Permissions - {selectedEmployee?.user.name}</DialogTitle>
					</DialogHeader>
					{selectedEmployee && currentEmployee && (
						<PermissionEditor
							employeeId={selectedEmployee.id}
							employeeName={selectedEmployee.user.name}
							organizationId={currentEmployee.organizationId}
							currentPermissions={permissions[selectedEmployee.id]}
							availableTeams={teams}
							onSuccess={() => {
								setSelectedEmployee(null);
								handleRefresh();
							}}
							onCancel={() => setSelectedEmployee(null)}
						/>
					)}
				</DialogContent>
			</Dialog>
		</div>
	);
}
