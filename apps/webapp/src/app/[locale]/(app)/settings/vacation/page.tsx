import { IconCalendar, IconClockHour4, IconEdit } from "@tabler/icons-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentEmployee } from "@/app/[locale]/(app)/approvals/actions";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { VacationManagement } from "@/components/settings/vacation-management";
import { VacationPoliciesTable } from "@/components/settings/vacation-policies-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getVacationPolicies } from "./actions";

async function VacationSettingsContent() {
	const currentEmployee = await getCurrentEmployee();

	if (!currentEmployee) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature="manage vacation settings" />
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
	const policiesResult = await getVacationPolicies(
		authContext.employee.organizationId,
		currentYear,
	);

	return (
		<VacationManagement organizationId={authContext.employee.organizationId}>
			<div className="grid gap-4">
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<IconCalendar className="size-5" />
							Vacation Policies
						</CardTitle>
						<CardDescription>
							Create different policies for various teams or employee groups
						</CardDescription>
					</CardHeader>
					<CardContent>
						<VacationPoliciesTable
							organizationId={authContext.employee.organizationId}
							initialPolicies={policiesResult.data || []}
						/>
					</CardContent>
				</Card>

				<div className="grid gap-4 md:grid-cols-2">
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2 text-base">
								<IconEdit className="size-4" />
								Employee Allowances
							</CardTitle>
						</CardHeader>
						<CardContent>
							<p className="mb-4 text-sm text-muted-foreground">
								Assign policies and configure custom allowances for individual employees
							</p>
							<Button variant="outline" size="sm" asChild className="w-full">
								<Link href="/settings/vacation/employees">Manage Employees</Link>
							</Button>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2 text-base">
								<IconClockHour4 className="size-4" />
								Adjustment History
							</CardTitle>
						</CardHeader>
						<CardContent>
							<p className="mb-4 text-sm text-muted-foreground">
								View audit trail of all manual adjustments
							</p>
							<Button variant="outline" size="sm" asChild className="w-full">
								<Link href="/settings/vacation/history">View History</Link>
							</Button>
						</CardContent>
					</Card>
				</div>
			</div>
		</VacationManagement>
	);
}

function VacationSettingsLoading() {
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
					<div className="space-y-4">
						<Skeleton className="h-24 w-full" />
						<Skeleton className="h-24 w-full" />
					</div>
				</CardContent>
			</Card>
		</div>
	);
}

export default function VacationSettingsPage() {
	return (
		<Suspense fallback={<VacationSettingsLoading />}>
			<VacationSettingsContent />
		</Suspense>
	);
}
