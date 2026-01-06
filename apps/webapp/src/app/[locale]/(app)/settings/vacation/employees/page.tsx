import { IconArrowBack, IconEdit, IconUser } from "@tabler/icons-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentEmployee } from "@/app/[locale]/(app)/approvals/actions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { getEmployeesWithAllowances, getVacationPolicy } from "../actions";

async function EmployeeAllowancesContent() {
	const currentEmployee = await getCurrentEmployee();

	if (!currentEmployee) {
		redirect("/");
	}

	const currentYear = new Date().getFullYear();
	const { data: employees } = await getEmployeesWithAllowances(
		currentEmployee.organizationId,
		currentYear,
	);
	const { data: orgPolicy } = await getVacationPolicy(currentEmployee.organizationId, currentYear);

	const defaultDays = orgPolicy?.defaultAnnualDays || "0";

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex items-center justify-between">
				<div>
					<div className="flex items-center gap-2">
						<Button variant="ghost" size="sm" asChild>
							<Link href="/settings/vacation">
								<IconArrowBack className="size-4" />
							</Link>
						</Button>
						<h1 className="text-2xl font-semibold tracking-tight">Employee Allowances</h1>
					</div>
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
										<TableHead>Team</TableHead>
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

										return (
											<TableRow key={emp.id}>
												<TableCell>
													<div className="flex items-center gap-3">
														<Avatar className="size-8">
															<AvatarImage src={emp.user.image || undefined} />
															<AvatarFallback>
																{emp.user.name
																	.split(" ")
																	.map((n) => n[0])
																	.join("")
																	.toUpperCase()}
															</AvatarFallback>
														</Avatar>
														<div>
															<div className="font-medium">{emp.user.name}</div>
															<div className="text-xs text-muted-foreground">{emp.user.email}</div>
														</div>
													</div>
												</TableCell>
												<TableCell>{emp.team?.name || "—"}</TableCell>
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
