import { eq } from "drizzle-orm";
import { connection } from "next/server";
import { Suspense } from "react";
import { Temporal } from "temporal-polyfill";
import { WorkDiagnosticsDashboard } from "@/components/settings/work-diagnostics/work-diagnostics-dashboard";
import { SettingsContentLoading } from "@/components/shells/settings-content-loading";
import { Skeleton } from "@/components/ui/skeleton";
import { db, user } from "@/db";
import { employee } from "@/db/schema";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { calendarDateEnvelope } from "@/lib/time-tracking/historical-work-diagnostics";
import { readHistoricalWorkDiagnostics } from "@/lib/time-tracking/historical-work-diagnostics-reader";
import { getTranslate } from "@/tolgee/server";

export const metadata = {
	title: "Work Diagnostics",
	description: "Find missing or conflicting time records and time entry chain issues",
};

type WorkDiagnosticsSearchParams = {
	start?: string;
	end?: string;
	employee?: string;
};

type WorkDiagnosticsPageProps = {
	searchParams?: Promise<WorkDiagnosticsSearchParams>;
};

export default function WorkDiagnosticsPage(props: WorkDiagnosticsPageProps) {
	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<Suspense fallback={<WorkDiagnosticsHeaderLoading />}>
				<WorkDiagnosticsHeader />
			</Suspense>
			<Suspense fallback={<SettingsContentLoading />}>
				<WorkDiagnosticsContent {...props} />
			</Suspense>
		</div>
	);
}

function WorkDiagnosticsHeaderLoading() {
	return (
		<div aria-busy="true" className="space-y-2">
			<Skeleton aria-hidden="true" className="h-8 w-56 max-w-full" />
			<Skeleton aria-hidden="true" className="h-4 w-96 max-w-full" />
		</div>
	);
}

async function WorkDiagnosticsHeader() {
	const t = await getTranslate();
	return (
		<div className="space-y-1">
			<h1 className="text-2xl font-semibold">
				{t("settings.workDiagnostics.title", "Work Diagnostics")}
			</h1>
			<p className="text-muted-foreground">
				{t(
					"settings.workDiagnostics.pageDescription",
					"Record-level diagnostics for historical work: missing or conflicting representations, adoption provenance, suspected manual-entry defects and time entry chain assurance.",
				)}
			</p>
		</div>
	);
}

async function WorkDiagnosticsContent({ searchParams }: WorkDiagnosticsPageProps) {
	const [{ organizationId }, t, params] = await Promise.all([
		requireOrgAdminSettingsAccess(),
		getTranslate(),
		searchParams ?? Promise.resolve({} as WorkDiagnosticsSearchParams),
	]);
	// The default work-diagnostics period must be resolved per request.
	await connection();
	const period = resolvePeriod(params);

	// Every employee, active or not: departed employees' history stays in scope.
	const employees = await db
		.select({
			id: employee.id,
			employeeNumber: employee.employeeNumber,
			name: user.name,
			firstName: user.firstName,
			lastName: user.lastName,
		})
		.from(employee)
		.innerJoin(user, eq(employee.userId, user.id))
		.where(eq(employee.organizationId, organizationId));
	const employeeLabels = Object.fromEntries(
		employees.map((row) => [
			row.id,
			[[row.firstName, row.lastName].filter(Boolean).join(" ") || row.name, row.employeeNumber]
				.filter(Boolean)
				.join(" · "),
		]),
	);
	const selectedEmployeeId =
		params.employee && params.employee in employeeLabels ? params.employee : null;

	const { work, appendAssurance } = await readHistoricalWorkDiagnostics(db, organizationId, {
		employeeIds: selectedEmployeeId ? [selectedEmployeeId] : employees.map((row) => row.id),
		range: calendarDateEnvelope(period.startDate, period.endDate),
	});

	const hrefFor = (change: { employeeId?: string | null; month?: "previous" | "next" }) => {
		const next = change.month ? shiftMonth(period.startDate, change.month) : period;
		const employeeId = change.employeeId === undefined ? selectedEmployeeId : change.employeeId;
		const query = new URLSearchParams({ start: next.startDate, end: next.endDate });
		if (employeeId) query.set("employee", employeeId);
		return `/settings/work-diagnostics?${query.toString()}`;
	};

	return (
		<WorkDiagnosticsDashboard
			t={t}
			data={{
				report: work,
				appendAssurance: [...appendAssurance].map(([employeeId, report]) => ({
					employeeId,
					report,
				})),
				employeeLabels,
				period,
				selectedEmployeeId,
				hrefFor,
			}}
		/>
	);
}

/** Calendar dates, independent of the viewer's zone; the envelope covers every zone. */
function resolvePeriod(params: WorkDiagnosticsSearchParams) {
	const parsed = parseDates(params.start, params.end);
	if (parsed) return parsed;
	const today = Temporal.Now.plainDateISO("UTC");
	return monthOf(today.toPlainYearMonth().subtract({ months: 1 }));
}

function parseDates(start: string | undefined, end: string | undefined) {
	if (!start || !end) return null;
	try {
		const startDate = parsePlainDate(start);
		const endDate = parsePlainDate(end);
		if (Temporal.PlainDate.compare(startDate, endDate) > 0) return null;
		return { startDate: startDate.toString(), endDate: endDate.toString() };
	} catch {
		return null;
	}
}

function shiftMonth(startDate: string, direction: "previous" | "next") {
	const month = parsePlainDate(startDate).toPlainYearMonth();
	return monthOf(month.add({ months: direction === "next" ? 1 : -1 }));
}

function monthOf(month: Temporal.PlainYearMonth) {
	return {
		startDate: month.toPlainDate({ day: 1 }).toString(),
		endDate: month.toPlainDate({ day: month.daysInMonth }).toString(),
	};
}
