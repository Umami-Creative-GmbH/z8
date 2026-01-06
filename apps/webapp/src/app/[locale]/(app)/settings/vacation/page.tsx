import { IconArrowBack, IconCalendar, IconClockHour4, IconEdit } from "@tabler/icons-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentEmployee } from "@/app/[locale]/(app)/approvals/actions";
import { VacationPolicyButton } from "@/components/settings/vacation-policy-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getVacationPolicy } from "./actions";

interface VacationPolicyCardProps {
	policy: {
		id: string;
		defaultAnnualDays: string;
		accrualType: string;
		accrualStartMonth: number | null;
		allowCarryover: boolean;
		maxCarryoverDays: string | null;
		carryoverExpiryMonths: number | null;
		createdAt: Date;
		creator: {
			name: string;
			email: string;
		};
	};
	organizationId: string;
	year: number;
}

function VacationPolicyCard({ policy, organizationId, year }: VacationPolicyCardProps) {
	return (
		<div className="space-y-4">
			<div className="grid gap-4 md:grid-cols-2">
				<div className="space-y-2">
					<div className="text-sm font-medium text-muted-foreground">Default Annual Days</div>
					<div className="text-2xl font-bold">{policy.defaultAnnualDays} days</div>
				</div>

				<div className="space-y-2">
					<div className="text-sm font-medium text-muted-foreground">Accrual Type</div>
					<div className="text-2xl font-bold capitalize">{policy.accrualType}</div>
				</div>

				<div className="space-y-2">
					<div className="text-sm font-medium text-muted-foreground">Accrual Starts</div>
					<div className="text-lg">
						{new Date(2000, (policy.accrualStartMonth || 1) - 1).toLocaleString("default", {
							month: "long",
						})}
					</div>
				</div>

				<div className="space-y-2">
					<div className="text-sm font-medium text-muted-foreground">Carryover</div>
					<div className="flex items-center gap-2">
						{policy.allowCarryover ? (
							<>
								<Badge variant="default">Enabled</Badge>
								{policy.maxCarryoverDays && (
									<span className="text-sm text-muted-foreground">
										(max {policy.maxCarryoverDays} days)
									</span>
								)}
							</>
						) : (
							<Badge variant="secondary">Disabled</Badge>
						)}
					</div>
				</div>

				{policy.allowCarryover && policy.carryoverExpiryMonths && (
					<div className="space-y-2">
						<div className="text-sm font-medium text-muted-foreground">Carryover Expiry</div>
						<div className="text-lg">{policy.carryoverExpiryMonths} months</div>
					</div>
				)}
			</div>

			<div className="rounded-lg border bg-muted/50 p-4">
				<div className="text-sm text-muted-foreground">
					Created by {policy.creator.name} on {new Date(policy.createdAt).toLocaleDateString()}
				</div>
			</div>
		</div>
	);
}

async function VacationSettingsContent() {
	const currentEmployee = await getCurrentEmployee();

	if (!currentEmployee) {
		redirect("/");
	}

	const currentYear = new Date().getFullYear();
	const { data: policy } = await getVacationPolicy(currentEmployee.organizationId, currentYear);

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex items-center justify-between">
				<div>
					<div className="flex items-center gap-2">
						<Button variant="ghost" size="sm" asChild>
							<Link href="/settings/holidays">
								<IconArrowBack className="size-4" />
							</Link>
						</Button>
						<h1 className="text-2xl font-semibold tracking-tight">Vacation Policy</h1>
					</div>
					<p className="text-sm text-muted-foreground">
						Manage organization-wide vacation allowance settings
					</p>
				</div>
			</div>

			<div className="grid gap-4">
				<Card>
					<CardHeader className="flex flex-row items-center justify-between">
						<div>
							<CardTitle className="flex items-center gap-2">
								<IconCalendar className="size-5" />
								{currentYear} Vacation Policy
							</CardTitle>
							<CardDescription>
								Organization-wide vacation allowance for the current calendar year
							</CardDescription>
						</div>
						<VacationPolicyButton
							organizationId={currentEmployee.organizationId}
							year={currentYear}
							existingPolicy={policy || undefined}
							variant="outline"
							size="sm"
						/>
					</CardHeader>
					<CardContent>
						{policy ? (
							<VacationPolicyCard
								policy={policy}
								organizationId={currentEmployee.organizationId}
								year={currentYear}
							/>
						) : (
							<div className="rounded-lg border border-dashed p-8 text-center">
								<div className="mx-auto flex max-w-[420px] flex-col items-center justify-center text-center">
									<IconCalendar className="size-10 text-muted-foreground" />
									<h3 className="mt-4 text-lg font-semibold">No policy configured</h3>
									<p className="mb-4 mt-2 text-sm text-muted-foreground">
										Create a vacation policy for {currentYear} to start managing employee
										allowances.
									</p>
									<VacationPolicyButton
										organizationId={currentEmployee.organizationId}
										year={currentYear}
									/>
								</div>
							</div>
						)}
					</CardContent>
				</Card>

				<div className="grid gap-4 md:grid-cols-3">
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2 text-base">
								<IconEdit className="size-4" />
								Employee Allowances
							</CardTitle>
						</CardHeader>
						<CardContent>
							<p className="mb-4 text-sm text-muted-foreground">
								Configure custom allowances for individual employees
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

					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2 text-base">
								<IconCalendar className="size-4" />
								Future Years
							</CardTitle>
						</CardHeader>
						<CardContent>
							<p className="mb-4 text-sm text-muted-foreground">
								Plan ahead by creating policies for upcoming years
							</p>
							<VacationPolicyButton
								organizationId={currentEmployee.organizationId}
								year={currentYear + 1}
								variant="outline"
								size="sm"
							/>
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
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
