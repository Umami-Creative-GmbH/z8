"use client";

import { IconPlus, IconSearch, IconUser } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { UserAvatar } from "@/components/user-avatar";
import { Link } from "@/navigation";
import { getCurrentEmployee } from "../../approvals/actions";
import { type EmployeeWithRelations, listEmployees } from "./actions";

export default function EmployeesPage() {
	const [employees, setEmployees] = useState<EmployeeWithRelations[]>([]);
	const [filteredEmployees, setFilteredEmployees] = useState<EmployeeWithRelations[]>([]);
	const [loading, setLoading] = useState(true);
	const [noEmployee, setNoEmployee] = useState(false);
	const [isAdmin, setIsAdmin] = useState(false);

	// Filters
	const [searchQuery, setSearchQuery] = useState("");
	const [roleFilter, setRoleFilter] = useState<string>("all");
	const [statusFilter, setStatusFilter] = useState<string>("all");

	useEffect(() => {
		async function loadData() {
			const currentEmp = await getCurrentEmployee();
			if (!currentEmp) {
				setNoEmployee(true);
				setLoading(false);
				return;
			}

			setIsAdmin(currentEmp.role === "admin");

			const result = await listEmployees();
			if (result.success) {
				setEmployees(result.data);
				setFilteredEmployees(result.data);
			} else {
				toast.error(result.error || "Failed to load employees");
			}
			setLoading(false);
		}

		loadData();
	}, []);

	// Apply filters
	useEffect(() => {
		let filtered = [...employees];

		// Search filter
		if (searchQuery) {
			const query = searchQuery.toLowerCase();
			filtered = filtered.filter(
				(emp) =>
					emp.user.name.toLowerCase().includes(query) ||
					emp.user.email.toLowerCase().includes(query) ||
					emp.firstName?.toLowerCase().includes(query) ||
					emp.lastName?.toLowerCase().includes(query) ||
					emp.position?.toLowerCase().includes(query),
			);
		}

		// Role filter
		if (roleFilter !== "all") {
			filtered = filtered.filter((emp) => emp.role === roleFilter);
		}

		// Status filter
		if (statusFilter !== "all") {
			filtered = filtered.filter((emp) =>
				statusFilter === "active" ? emp.isActive : !emp.isActive,
			);
		}

		setFilteredEmployees(filtered);
	}, [searchQuery, roleFilter, statusFilter, employees]);

	if (noEmployee) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature="manage employees" />
			</div>
		);
	}

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight">Employees</h1>
					<p className="text-sm text-muted-foreground">
						Manage employee profiles, teams, and permissions
					</p>
				</div>
				{isAdmin && (
					<Button asChild>
						<Link href="/settings/employees/new">
							<IconPlus className="mr-2 size-4" />
							Add Employee
						</Link>
					</Button>
				)}
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Employee Directory</CardTitle>
					<CardDescription>
						{filteredEmployees.length} of {employees.length} employees
					</CardDescription>
				</CardHeader>
				<CardContent>
					{/* Filters */}
					<div className="mb-4 flex flex-col gap-4 sm:flex-row">
						<div className="relative flex-1">
							<IconSearch className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
							<Input
								placeholder="Search by name, email, or position..."
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								className="pl-9"
							/>
						</div>
						<Select value={roleFilter} onValueChange={setRoleFilter}>
							<SelectTrigger className="w-full sm:w-[180px]">
								<SelectValue placeholder="Filter by role" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All Roles</SelectItem>
								<SelectItem value="admin">Admin</SelectItem>
								<SelectItem value="manager">Manager</SelectItem>
								<SelectItem value="employee">Employee</SelectItem>
							</SelectContent>
						</Select>
						<Select value={statusFilter} onValueChange={setStatusFilter}>
							<SelectTrigger className="w-full sm:w-[180px]">
								<SelectValue placeholder="Filter by status" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All Status</SelectItem>
								<SelectItem value="active">Active</SelectItem>
								<SelectItem value="inactive">Inactive</SelectItem>
							</SelectContent>
						</Select>
					</div>

					{/* Table */}
					{loading ? (
						<div className="flex items-center justify-center py-8">
							<p className="text-sm text-muted-foreground">Loading employees...</p>
						</div>
					) : filteredEmployees.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-8">
							<IconUser className="mb-4 size-12 text-muted-foreground" />
							<p className="text-sm text-muted-foreground">No employees found</p>
						</div>
					) : (
						<div className="overflow-x-auto">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Employee</TableHead>
										<TableHead>Position</TableHead>
										<TableHead>Team</TableHead>
										<TableHead>Role</TableHead>
										<TableHead>Status</TableHead>
										<TableHead className="text-right">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{filteredEmployees.map((emp) => (
										<TableRow key={emp.id}>
											<TableCell>
												<div className="flex items-center gap-3">
													<UserAvatar
														image={emp.user.image}
														seed={emp.user.id}
														name={emp.user.name}
														size="sm"
													/>
													<div>
														<div className="font-medium">{emp.user.name}</div>
														<div className="text-sm text-muted-foreground">{emp.user.email}</div>
													</div>
												</div>
											</TableCell>
											<TableCell>{emp.position || "—"}</TableCell>
											<TableCell>{emp.team?.name || "—"}</TableCell>
											<TableCell>
												<Badge
													variant={
														emp.role === "admin"
															? "default"
															: emp.role === "manager"
																? "secondary"
																: "outline"
													}
												>
													{emp.role}
												</Badge>
											</TableCell>
											<TableCell>
												<Badge variant={emp.isActive ? "default" : "secondary"}>
													{emp.isActive ? "Active" : "Inactive"}
												</Badge>
											</TableCell>
											<TableCell className="text-right">
												<Button variant="ghost" size="sm" asChild>
													<Link href={`/settings/employees/${emp.id}`}>View Details</Link>
												</Button>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
