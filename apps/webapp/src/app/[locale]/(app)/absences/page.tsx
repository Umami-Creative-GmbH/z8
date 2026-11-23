import { IconAlertTriangle } from "@tabler/icons-react";
import { eq } from "drizzle-orm";
import { connection } from "next/server";
import { Suspense } from "react";
import { AbsencesViewContainer } from "@/components/absences/absences-view-container";
import { VacationBalanceCard } from "@/components/absences/vacation-balance-card";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { OnCallStatusCard } from "@/components/statutory/on-call/on-call-status-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { LoadingRegion } from "@/components/ui/loading-region";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { parseAbsencesUrlState } from "@/lib/absences/absences-url";
import { hasZeroWorkingDaysSchedule } from "@/lib/absences/types";
import {
	instantToCanonicalString,
	plainDateAt,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { getTranslate } from "@/tolgee/server";
import { getCurrentEmployee, getVacationBalanceResult } from "./actions";
import { readAbsenceCalendarYear } from "./calendar-year";
import { getAbsenceCategories } from "./queries";

interface AbsencesPageProps {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function AbsencesPageContent({ searchParams }: AbsencesPageProps) {
	// Auth is checked in layout - session is guaranteed to exist
	const [t, employee, query] = await Promise.all([
		getTranslate(),
		getCurrentEmployee(),
		searchParams,
	]);
	if (!employee) {
		return (
			<div className="page-frame flex flex-1 flex-col gap-6">
				<PageHeader title={t("absences.title", "Absences")} />
				<NoEmployeeError
					feature={t("absences.featureName", "manage absences")}
				/>
			</div>
		);
	}

	const org = await db.query.organization.findFirst({
		where: eq(organization.id, employee.organizationId),
		columns: { timezone: true, name: true },
	});
	const timezone = org?.timezone || "UTC";
	// The employee's current local calendar year must be resolved per request.
	await connection();
	const now = systemClock.nowInstant();
	const nowIso = instantToCanonicalString(now);
	const today = plainDateAt(now, timezone);
	const calendarYear = today.year;
	const currentDate = today.toString();

	// The record view follows the linked year; the balance stays on the current calendar year.
	const { view: initialView, year: recordYear } = parseAbsencesUrlState(
		query,
		calendarYear,
	);

	// Fetch all data in parallel
	const [
		{ balance: vacationBalance, configuration },
		{ absences, holidays },
		categories,
	] = await Promise.all([
		getVacationBalanceResult(employee.id, calendarYear, timezone),
		readAbsenceCalendarYear(employee.id, recordYear),
		getAbsenceCategories(employee.organizationId),
	]);

	return (
		<div className="@container/main page-frame flex min-w-0 flex-1 flex-col gap-6">
			<PageHeader
				title={t("absences.title", "Absences")}
				// The year lives with the balance and the year navigation, which can differ.
				scope={
					<>
						{org?.name} · {timezone}
					</>
				}
			/>
			{vacationBalance ? (
				<VacationBalanceCard
					balance={vacationBalance}
					now={nowIso}
					timezone={timezone}
				/>
			) : (
				<Alert>
					<IconAlertTriangle aria-hidden="true" />
					<AlertTitle>
						{hasZeroWorkingDaysSchedule(configuration)
							? t(
									"common:vacationBalance.zeroWorkingDays",
									"Work schedule without working days",
								)
							: configuration?.status === "conflict"
								? t(
										"common:vacationBalance.conflictingPolicies",
										"Conflicting vacation policies",
									)
								: t(
										"common:vacationBalance.missingPolicy",
										"Missing vacation policy",
									)}
					</AlertTitle>
					<AlertDescription>
						<p>
							{t(
								"absences.errors.policyConfigurationMessage",
								"Vacation policy configuration needs attention for {currentYear}.",
								{ currentYear: calendarYear },
							)}{" "}
							{t(
								"absences.errors.contactAdmin",
								"Please contact your administrator to configure vacation policies.",
							)}
						</p>
					</AlertDescription>
				</Alert>
			)}
			{/* § 12 TzBfG reference hours for on-call sick leave and holidays (#1992). */}
			<OnCallStatusCard organizationId={employee.organizationId} employeeId={employee.id} />
			<AbsencesViewContainer
				key={`${employee.organizationId}:${employee.id}`}
				absences={absences}
				holidays={holidays}
				categories={categories}
				organizationId={employee.organizationId}
				year={recordYear}
				initialView={initialView}
				currentDate={currentDate}
			/>
		</div>
	);
}

async function AbsencesPageLoading() {
	const t = await getTranslate();
	return (
		<LoadingRegion
			className="@container/main page-frame flex flex-1 flex-col gap-6"
			role="status"
			label={{
				labelKey: "common.loadingRegions.absences",
				labelDefault: "Loading absences",
			}}
		>
			<PageHeader title={t("absences.title", "Absences")} />
			{/* Mirrors the balance strip, the year toolbar and the calendar. */}
			<Skeleton aria-hidden="true" className="h-40 w-full rounded-xl" />
			<div className="flex flex-wrap items-center justify-between gap-3">
				<Skeleton aria-hidden="true" className="h-9 w-40" />
				<Skeleton aria-hidden="true" className="h-9 w-80 max-w-full" />
			</div>
			<Skeleton aria-hidden="true" className="h-96 w-full rounded-xl" />
		</LoadingRegion>
	);
}

export default function AbsencesPage(props: AbsencesPageProps) {
	return (
		<Suspense fallback={<AbsencesPageLoading />}>
			<AbsencesPageContent {...props} />
		</Suspense>
	);
}
