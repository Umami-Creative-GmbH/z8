import { DateTime } from "luxon";
import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import { connection } from "next/server";
import { Suspense } from "react";
import { Temporal } from "temporal-polyfill";
import { PayrollReadinessDashboard } from "@/components/settings/payroll-readiness/payroll-readiness-dashboard";
import {
	formatPayrollReadinessPeriod,
	type PayrollReadinessSearchParams,
	resolvePayrollReadinessPeriod,
} from "@/components/settings/payroll-readiness/payroll-readiness-period";
import { PayrollReadinessPeriodNav } from "@/components/settings/payroll-readiness/payroll-readiness-period-nav";
import { LoadingRegion } from "@/components/ui/loading-region";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getPayrollReadiness } from "@/lib/payroll-readiness/get-payroll-readiness";
import { getTranslate } from "@/tolgee/server";

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslate();

	return {
		title: t("settings.payrollReadiness.title", "Payroll Readiness"),
		description: t(
			"settings.payrollReadiness.description",
			"Check whether a payroll period is ready before exporting time, absence, and payroll data.",
		),
	};
}

const PAYROLL_READINESS_SUMMARY_LOADING_KEYS = [
	"status",
	"period",
	"blockers",
	"warnings",
	"targets",
	"employees",
] as const;

type PayrollReadinessPageProps = {
	searchParams?: Promise<PayrollReadinessSearchParams>;
};

function PayrollReadinessPageContent(props: PayrollReadinessPageProps) {
	return (
		<div className="page-frame flex flex-1 flex-col gap-6">
			<Suspense fallback={<PayrollReadinessHeaderLoading />}>
				<PayrollReadinessHeader {...props} />
			</Suspense>
			<Suspense fallback={<PayrollReadinessBodyLoading />}>
				<PayrollReadinessContent {...props} />
			</Suspense>
		</div>
	);
}

function PayrollReadinessBodyLoading() {
	return (
		<LoadingRegion
			className="flex flex-col gap-6"
			role="status"
			label={{
				labelKey: "common.loadingRegions.payrollReadiness",
				labelDefault: "Loading payroll readiness",
			}}
		>
			<div className="grid gap-px overflow-hidden rounded-lg border md:grid-cols-2 xl:grid-cols-3">
				{PAYROLL_READINESS_SUMMARY_LOADING_KEYS.map((key) => (
					<Skeleton key={key} aria-hidden="true" className="h-24 w-full rounded-none" />
				))}
			</div>
			<Skeleton aria-hidden="true" className="h-72 w-full" />
		</LoadingRegion>
	);
}

function PayrollReadinessHeaderLoading() {
	return (
		<div
			aria-busy="true"
			className="space-y-2"
			data-testid="payroll-readiness-header-loading"
		>
			<Skeleton aria-hidden="true" className="h-4 w-48 max-w-full" />
			<Skeleton aria-hidden="true" className="h-8 w-56 max-w-full" />
			<Skeleton aria-hidden="true" className="h-4 w-96 max-w-full" />
		</div>
	);
}

async function PayrollReadinessHeader({ searchParams }: PayrollReadinessPageProps) {
	const [t, locale, resolvedSearchParams] = await Promise.all([
		getTranslate(),
		getLocale(),
		searchParams ?? Promise.resolve({}),
	]);
	// The period label and the month shortcuts follow today's UTC date.
	await connection();
	const period = getPayrollReadinessPeriod(resolvedSearchParams);

	return (
		<PageHeader
			scope={t(
				"settings.payrollReadiness.period.scope",
				"Payroll period: {period} (UTC)",
				{ period: formatPayrollReadinessPeriod(period, locale) },
			)}
			title={t("settings.payrollReadiness.title", "Payroll Readiness")}
			description={t(
				"settings.payrollReadiness.description",
				"Check whether a payroll period is ready before exporting time, absence, and payroll data.",
			)}
			actions={
				<PayrollReadinessPeriodNav
					t={t}
					locale={locale}
					period={period}
					today={period.today}
				/>
			}
		/>
	);
}

async function PayrollReadinessContent({
	searchParams,
}: PayrollReadinessPageProps) {
	const [{ organizationId }, t, locale, resolvedSearchParams] = await Promise.all([
		requireOrgAdminSettingsAccess(),
		getTranslate(),
		getLocale(),
		searchParams ?? Promise.resolve({}),
	]);
	// The default payroll-readiness period must be resolved per request.
	await connection();
	const period = getPayrollReadinessPeriod(resolvedSearchParams);
	// getPayrollReadiness still takes Luxon values: convert at its boundary, as UTC days.
	const data = await getPayrollReadiness({
		organizationId,
		period: {
			start: DateTime.fromISO(period.start.toString(), { zone: "utc" }),
			end: DateTime.fromISO(period.end.toString(), { zone: "utc" }),
		},
	});

	return (
		<PayrollReadinessDashboard
			t={t}
			data={data}
			periodLabel={formatPayrollReadinessPeriod(period, locale)}
		/>
	);
}

function PayrollReadinessPageLoading() {
	return (
		<LoadingRegion
			className="page-frame flex flex-1 flex-col gap-6"
			role="status"
			label={{
				labelKey: "common.loadingRegions.payrollReadiness",
				labelDefault: "Loading payroll readiness",
			}}
		>
			<div className="space-y-2">
				<Skeleton aria-hidden="true" className="h-4 w-48" />
				<Skeleton aria-hidden="true" className="h-8 w-56" />
				<Skeleton aria-hidden="true" className="h-4 w-full max-w-2xl" />
			</div>
			<div className="grid gap-px overflow-hidden rounded-lg border md:grid-cols-2 xl:grid-cols-3">
				{PAYROLL_READINESS_SUMMARY_LOADING_KEYS.map((key) => (
					<Skeleton key={key} aria-hidden="true" className="h-24 w-full rounded-none" />
				))}
			</div>
			<Skeleton aria-hidden="true" className="h-72 w-full" />
		</LoadingRegion>
	);
}

export default function PayrollReadinessPage(props: PayrollReadinessPageProps) {
	return (
		<Suspense fallback={<PayrollReadinessPageLoading />}>
			<PayrollReadinessPageContent {...props} />
		</Suspense>
	);
}

/** The requested period as UTC days; the default is the previous UTC month. */
function getPayrollReadinessPeriod(searchParams: PayrollReadinessSearchParams) {
	const today = Temporal.Now.plainDateISO("UTC");
	return { ...resolvePayrollReadinessPeriod(searchParams, today), today };
}
