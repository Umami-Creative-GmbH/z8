import { eq } from "drizzle-orm";
import { connection } from "next/server";
import { Suspense } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { calendarYearAt, systemClock } from "@/lib/datetime/temporal-core";
import { resolveOrganizationTimezone } from "@/lib/timezone/resolve-timezone";
import { getTranslate } from "@/tolgee/server";
import {
	getCompanyDefaultVacationPolicy,
	getEmployeesWithAllowances,
} from "../actions";
import { getVacationPolicyAssignments } from "../assignment-actions";
import { EmployeeAllowancesView } from "./employee-allowances-view";

async function EmployeeAllowancesContent() {
	const [{ organizationId }, t] = await Promise.all([
		requireOrgAdminSettingsAccess(),
		getTranslate(),
	]);
	const ownedOrganization = await db.query.organization.findFirst({
		where: eq(organization.id, organizationId),
		columns: { timezone: true },
	});
	const timezone = resolveOrganizationTimezone(
		ownedOrganization?.timezone,
	).timezone;

	// The current vacation allowance year must be resolved per request.
	await connection();
	const currentYear = calendarYearAt(systemClock.nowInstant(), timezone);
	const [employeesResult, policyResult, policyAssignmentsResult] =
		await Promise.all([
			getEmployeesWithAllowances(organizationId, currentYear),
			getCompanyDefaultVacationPolicy(organizationId),
			getVacationPolicyAssignments(organizationId),
		]);

	const employees = employeesResult.success ? employeesResult.data : [];
	const orgPolicy = policyResult.success ? policyResult.data : null;
	const policyAssignments = policyAssignmentsResult.success
		? policyAssignmentsResult.data
		: [];
	const defaultDays = orgPolicy?.defaultAnnualDays || "0";

	return (
		<EmployeeAllowancesView
			currentYear={currentYear}
			defaultDays={defaultDays}
			employees={employees}
			hasOrganizationPolicy={Boolean(orgPolicy)}
			policyAssignments={policyAssignments}
			t={t}
		/>
	);
}

function EmployeeAllowancesLoading() {
	return (
		<div
			className="flex flex-1 flex-col gap-4 p-4"
			role="status"
			aria-label="Loading employee vacation allowances"
		>
			<div className="space-y-2">
				<Skeleton aria-hidden="true" className="h-8 w-64" />
				<Skeleton aria-hidden="true" className="h-4 w-96" />
			</div>
			<Card>
				<CardHeader>
					<Skeleton aria-hidden="true" className="h-6 w-48" />
					<Skeleton aria-hidden="true" className="h-4 w-96" />
				</CardHeader>
				<CardContent>
					<div className="space-y-3">
						<Skeleton aria-hidden="true" className="h-12 w-full" />
						<Skeleton aria-hidden="true" className="h-12 w-full" />
						<Skeleton aria-hidden="true" className="h-12 w-full" />
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
