import { connection } from "next/server";
import { DateTime } from "luxon";
import { PayrollReadinessDashboard } from "@/components/settings/payroll-readiness/payroll-readiness-dashboard";
import { LegalEntitySelector } from "@/components/settings/legal-entities/legal-entity-selector";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getLegalEntitySelectionContext } from "@/lib/legal-entities/access";
import { getPayrollReadiness } from "@/lib/payroll-readiness/get-payroll-readiness";
import { getTranslate } from "@/tolgee/server";

export const metadata = {
	title: "Payroll Readiness",
	description: "Check whether a payroll period is ready before export",
};

type PayrollReadinessSearchParams = {
	start?: string;
	end?: string;
	legalEntityId?: string;
};

export default async function PayrollReadinessPage({
	searchParams,
}: {
	searchParams?: Promise<PayrollReadinessSearchParams>;
}) {
	await connection();
	const [{ organizationId }, t, resolvedSearchParams] = await Promise.all([
		requireOrgAdminSettingsAccess(),
		getTranslate(),
		searchParams ?? Promise.resolve({} as PayrollReadinessSearchParams),
	]);
	const { entities, selectedLegalEntityId } = await getLegalEntitySelectionContext({
		organizationId,
		requestedLegalEntityId: resolvedSearchParams.legalEntityId ?? null,
		isOrgAdmin: true,
		allowedLegalEntityIds: [],
	});
	const period = getPayrollReadinessPeriod(resolvedSearchParams);
	const data = await getPayrollReadiness({ organizationId, legalEntityId: selectedLegalEntityId, period });

	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
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
			<LegalEntitySelector entities={entities} selectedLegalEntityId={selectedLegalEntityId} />
			<PayrollReadinessDashboard t={t} data={data} />
		</div>
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
