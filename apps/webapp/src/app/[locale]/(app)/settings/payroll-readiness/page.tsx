import { DateTime } from "luxon";
import { connection } from "next/server";
import { Suspense } from "react";
import { PayrollReadinessDashboard } from "@/components/settings/payroll-readiness/payroll-readiness-dashboard";
import { SettingsContentLoading } from "@/components/shells/settings-content-loading";
import { Skeleton } from "@/components/ui/skeleton";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getPayrollReadiness } from "@/lib/payroll-readiness/get-payroll-readiness";
import { getTranslate } from "@/tolgee/server";

export const metadata = {
	title: "Payroll Readiness",
	description: "Check whether a payroll period is ready before export",
};

type PayrollReadinessSearchParams = {
	start?: string;
	end?: string;
};

type PayrollReadinessPageProps = {
	searchParams?: Promise<PayrollReadinessSearchParams>;
};

function PayrollReadinessPageContent(props: PayrollReadinessPageProps) {
	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<Suspense fallback={<PayrollReadinessHeaderLoading />}>
				<PayrollReadinessHeader />
			</Suspense>
			<Suspense fallback={<SettingsContentLoading />}>
				<PayrollReadinessContent {...props} />
			</Suspense>
		</div>
	);
}

function PayrollReadinessHeaderLoading() {
	return (
		<div
			aria-busy="true"
			className="space-y-2"
			data-testid="payroll-readiness-header-loading"
		>
			<Skeleton aria-hidden="true" className="h-8 w-56 max-w-full" />
			<Skeleton aria-hidden="true" className="h-4 w-96 max-w-full" />
		</div>
	);
}

async function PayrollReadinessHeader() {
	const t = await getTranslate();

	return (
		<div className="space-y-1">
			<h1 className="text-2xl font-semibold">
				{t("settings.payrollReadiness.title", "Payroll Readiness")}
			</h1>
			<p className="text-muted-foreground">
				{t(
					"settings.payrollReadiness.description",
					"Check whether a payroll period is ready before exporting time, absence, and payroll data.",
				)}
			</p>
		</div>
	);
}

async function PayrollReadinessContent({
	searchParams,
}: PayrollReadinessPageProps) {
	const [{ organizationId }, t, resolvedSearchParams] = await Promise.all([
		requireOrgAdminSettingsAccess(),
		getTranslate(),
		searchParams ?? Promise.resolve({}),
	]);
	// The default payroll-readiness period must be resolved per request.
	await connection();
	const period = getPayrollReadinessPeriod(resolvedSearchParams);
	const data = await getPayrollReadiness({ organizationId, period });

	return <PayrollReadinessDashboard t={t} data={data} />;
}

function PayrollReadinessPageLoading() {
	return (
		<div
			className="flex flex-1 flex-col gap-6 p-4 md:p-6"
			role="status"
			aria-label="Loading payroll readiness"
		>
			<div className="space-y-2">
				<Skeleton aria-hidden="true" className="h-8 w-56" />
				<Skeleton aria-hidden="true" className="h-4 w-full max-w-2xl" />
			</div>
			<div className="grid gap-4 md:grid-cols-3">
				<Skeleton aria-hidden="true" className="h-28 w-full" />
				<Skeleton aria-hidden="true" className="h-28 w-full" />
				<Skeleton aria-hidden="true" className="h-28 w-full" />
			</div>
			<Skeleton aria-hidden="true" className="h-72 w-full" />
		</div>
	);
}

export default function PayrollReadinessPage(props: PayrollReadinessPageProps) {
	return (
		<Suspense fallback={<PayrollReadinessPageLoading />}>
			<PayrollReadinessPageContent {...props} />
		</Suspense>
	);
}

function getPayrollReadinessPeriod(searchParams: PayrollReadinessSearchParams) {
	const defaultMonth = DateTime.utc().minus({ months: 1 });
	const defaultStart = defaultMonth.startOf("month");
	const defaultEnd = defaultMonth.endOf("month");

	return {
		start: parseUtcDate(searchParams.start, defaultStart),
		end: parseUtcDate(searchParams.end, defaultEnd),
	};
}

function parseUtcDate(value: string | undefined, fallback: DateTime) {
	if (!value) {
		return fallback;
	}

	const parsed = DateTime.fromISO(value, { zone: "utc" });

	return parsed.isValid ? parsed : fallback;
}
