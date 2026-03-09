"use client";

import { IconLoader2, IconShield, IconUserCog } from "@tabler/icons-react";
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
import type { SelectableEmployee } from "../employees/actions";
import type { TeamItem } from "./page-utils";

export function PermissionsEmptyState({ noEmployee }: { noEmployee: boolean }) {
	if (noEmployee) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature="manage permissions" />
			</div>
		);
	}

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

export function PermissionsTableCard(props: {
	loading: boolean;
	searchQuery: string;
	onSearchChange: (value: string) => void;
	onRefresh: () => void;
	employees: SelectableEmployee[];
	onEdit: (employee: SelectableEmployee) => void;
	getSummary: (employeeId: string) => { count: number; scope: string } | null;
}) {
	const { loading, searchQuery, onSearchChange, onRefresh, employees, onEdit, getSummary } = props;

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<div>
						<CardTitle>Employee Permissions</CardTitle>
						<CardDescription>Click on an employee to edit their permissions</CardDescription>
					</div>
					<Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
						{loading ? <IconLoader2 className="mr-2 size-4 animate-spin" /> : null}
						Refresh
					</Button>
				</div>
			</CardHeader>
			<CardContent>
				<div className="space-y-4">
					<Input
						placeholder="Search by name, email, or position..."
						value={searchQuery}
						onChange={(event) => onSearchChange(event.target.value)}
						className="max-w-sm"
					/>

					{loading ? (
						<div className="flex items-center justify-center py-8">
							<IconLoader2 className="size-8 animate-spin text-muted-foreground" />
						</div>
					) : employees.length === 0 ? (
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
								{employees.map((employee) => {
									const permissionSummary = getSummary(employee.id);

									return (
										<TableRow key={employee.id}>
											<TableCell>
												<div className="flex items-center gap-3">
													<UserAvatar
														image={employee.user.image}
														seed={employee.id}
														name={employee.user.name}
														size="sm"
													/>
													<div>
														<div className="font-medium">{employee.user.name}</div>
														<div className="text-sm text-muted-foreground">
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
													{employee.role}
												</Badge>
											</TableCell>
											<TableCell>
												{employee.role === "admin" ? (
													<Badge variant="default">All Permissions</Badge>
												) : permissionSummary ? (
													<div className="flex gap-2">
														<Badge variant="secondary">
															{permissionSummary.count} permission
															{permissionSummary.count !== 1 ? "s" : ""}
														</Badge>
														<Badge variant="outline">{permissionSummary.scope}</Badge>
													</div>
												) : (
													<span className="text-sm text-muted-foreground">No permissions</span>
												)}
											</TableCell>
											<TableCell className="text-right">
												<Button
													variant="ghost"
													size="sm"
													onClick={() => onEdit(employee)}
													disabled={employee.role === "admin"}
												>
													{employee.role === "admin" ? "—" : "Edit"}
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
	);
}

export function PermissionEditorDialog(props: {
	selectedEmployee: SelectableEmployee | null;
	currentEmployee: { organizationId: string } | null;
	teams: TeamItem[];
	currentPermissions: Record<string, any>;
	onClose: () => void;
	onSuccess: () => void;
}) {
	const { selectedEmployee, currentEmployee, teams, currentPermissions, onClose, onSuccess } =
		props;

	return (
		<Dialog open={!!selectedEmployee} onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>Edit Permissions - {selectedEmployee?.user.name}</DialogTitle>
				</DialogHeader>
				{selectedEmployee && currentEmployee ? (
					<PermissionEditor
						employeeId={selectedEmployee.id}
						employeeName={selectedEmployee.user.name}
						organizationId={currentEmployee.organizationId}
						currentPermissions={currentPermissions[selectedEmployee.id]}
						availableTeams={teams}
						onSuccess={onSuccess}
						onCancel={onClose}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}
