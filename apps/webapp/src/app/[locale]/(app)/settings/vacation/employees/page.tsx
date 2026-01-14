import { IconEdit, IconUser } from "@tabler/icons-react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getCurrentEmployee } from "@/app/[locale]/(app)/approvals/actions";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
import { getCompanyDefaultVacationPolicy, getEmployeesWithAllowances } from "../actions";
import { getVacationPolicyAssignments } from "../assignment-actions";

async function EmployeeAllowancesContent() {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	const currentEmployee = await getCurrentEmployee();

	if (!currentEmployee) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature="manage employee vacation allowances" />
			</div>
		);
	}

	// Check if user has admin role
	const { getAuthContext } = await import("@/lib/auth-helpers");
	const authContext = await getAuthContext();

	if (!authContext?.employee || authContext.employee.role !== "admin") {
		redirect("/");
	}

	const currentYear = new Date().getFullYear();
	const [employeesResult, policyResult, policyAssignmentsResult] = await Promise.all([
		getEmployeesWithAllowances(authContext.employee.organizationId, currentYear),
		getCompanyDefaultVacationPolicy(authContext.employee.organizationId),
		getVacationPolicyAssignments(authContext.employee.organizationId),
	]);

	const employees = employeesResult.success ? employeesResult.data : [];
	const orgPolicy = policyResult.success ? policyResult.data : null;
	const policyAssignments = policyAssignmentsResult.success ? policyAssignmentsResult.data : [];
	const defaultDays = orgPolicy?.defaultAnnualDays || "0";

	// Build a map of employeeId -> policy assignment (only employee-level assignments)
	const employeePolicyMap = new Map<string, any>();
	policyAssignments?.forEach((assignment: any) => {
		if (assignment.assignmentType === "employee" && assignment.employeeId) {
			employeePolicyMap.set(assignment.employeeId, assignment);
		}
	});

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight">Employee Allowances</h1>
					<p className="text-sm text-muted-foreground">
						Configure custom vacation allowances for individual employees
					</p>
				</div>
			</div>

			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<CardTitle>Vacation Allowances for {currentYear}</CardTitle>
							<CardDescription>
								Default allowance: {defaultDays} days per year
								{!orgPolicy && " (No org policy configured)"}
							</CardDescription>
						</div>
						<Badge variant="secondary">{employees.length} employees</Badge>
					</div>
				</CardHeader>
				<CardContent>
					{employees.length === 0 ? (
						<div className="rounded-lg border border-dashed p-8 text-center">
							<IconUser className="mx-auto size-10 text-muted-foreground" />
							<h3 className="mt-4 text-lg font-semibold">No employees found</h3>
							<p className="mt-2 text-sm text-muted-foreground">
								Add employees to your organization to manage their vacation allowances.
							</p>
						</div>
					) : (
						<div className="rounded-md border">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Employee</TableHead>
										<TableHead>Policy</TableHead>
										<TableHead>Team</TableHead>
										<TableHead>Managers</TableHead>
										<TableHead className="text-right">Default Days</TableHead>
										<TableHead className="text-right">Custom Days</TableHead>
										<TableHead className="text-right">Carryover</TableHead>
										<TableHead className="text-right">Adjustments</TableHead>
										<TableHead className="text-right">Total Available</TableHead>
										<TableHead className="text-right">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{employees.map((emp) => {
										const allowance = emp.vacationAllowances[0];
										const customDays = allowance?.customAnnualDays
											? parseFloat(allowance.customAnnualDays)
											: null;
										const annualDays = customDays !== null ? customDays : parseFloat(defaultDays);
										const carryover = allowance?.customCarryoverDays
											? parseFloat(allowance.customCarryoverDays)
											: 0;
										const adjustments = allowance?.adjustmentDays
											? parseFloat(allowance.adjustmentDays)
											: 0;
										const total = annualDays + carryover + adjustments;
										const policyAssignment = employeePolicyMap.get(emp.id);

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
															<div className="text-xs text-muted-foreground">{emp.user.email}</div>
														</div>
													</div>
												</TableCell>
												<TableCell>
													{policyAssignment ? (
														<Badge variant="outline">{policyAssignment.policy?.name}</Badge>
													) : (
														<span className="text-muted-foreground text-sm">Default</span>
													)}
												</TableCell>
												<TableCell>{emp.team?.name || "—"}</TableCell>
												<TableCell>
													{emp.managers && emp.managers.length > 0 ? (
														<div className="flex flex-col gap-1">
															{emp.managers.map((m: any) => (
																<div key={m.id} className="flex items-center gap-1">
																	<span className="text-sm">{m.manager.user.name}</span>
																	{m.isPrimary && (
																		<Badge variant="secondary" className="text-xs">
																			Primary
																		</Badge>
																	)}
																</div>
															))}
														</div>
													) : (
														<span className="text-muted-foreground">—</span>
													)}
												</TableCell>
												<TableCell className="text-right tabular-nums">
													{customDays === null ? (
														<span className="text-muted-foreground">{defaultDays}</span>
													) : (
														<span className="text-muted-foreground line-through">
															{defaultDays}
														</span>
													)}
												</TableCell>
												<TableCell className="text-right tabular-nums">
													{customDays !== null ? (
														<Badge variant="default">{customDays}</Badge>
													) : (
														<span className="text-muted-foreground">—</span>
													)}
												</TableCell>
												<TableCell className="text-right tabular-nums">
													{carryover > 0 ? (
														<span className="text-green-600">+{carryover}</span>
													) : (
														<span className="text-muted-foreground">—</span>
													)}
												</TableCell>
												<TableCell className="text-right tabular-nums">
													{adjustments !== 0 ? (
														<span className={adjustments > 0 ? "text-green-600" : "text-red-600"}>
															{adjustments > 0 ? "+" : ""}
															{adjustments}
														</span>
													) : (
														<span className="text-muted-foreground">—</span>
													)}
												</TableCell>
												<TableCell className="text-right font-semibold tabular-nums">
													{total}
												</TableCell>
												<TableCell className="text-right">
													<Button variant="ghost" size="sm" asChild>
														<Link href={`/settings/vacation/employees/${emp.id}`}>
															<IconEdit className="mr-1 size-4" />
															Edit
														</Link>
													</Button>
												</TableCell>
											</TableRow>
										);
									})}
								</TableBody>
							</Table>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}

function EmployeeAllowancesLoading() {
	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="space-y-2">
				<Skeleton className="h-8 w-64" />
				<Skeleton className="h-4 w-96" />
			</div>
			<Card>
				<CardHeader>
					<Skeleton className="h-6 w-48" />
					<Skeleton className="h-4 w-96" />
				</CardHeader>
				<CardContent>
					<div className="space-y-3">
						<Skeleton className="h-12 w-full" />
						<Skeleton className="h-12 w-full" />
						<Skeleton className="h-12 w-full" />
					</div>
				</CardContent>
			</Card>
		</div>
	);
}

export default function EmployeeAllowancesPage() {
	return (
		<Suspense fallback={<EmployeeAllowancesLoading />}>
			<EmployeeAllowancesContent />
		</Suspense>
	);
}
