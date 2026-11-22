import { IconAlertCircle } from "@tabler/icons-react";
import { getLocale } from "next-intl/server";
import { Suspense } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
	type AuthContext,
	getCurrentSettingsAccess,
	getCurrentSettingsRouteContext,
} from "@/lib/auth-helpers";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access";
import { getTranslate } from "@/tolgee/server";
import {
	getAdoptionStatistics,
	getAttentionStatistics,
	getMonthStatistics,
	getStatisticsScope,
	getWorkforceStatistics,
} from "../settings/statistics/actions";
import { loadApprovalInboxSummary } from "../settings/statistics/approval-inbox-summary";
import {
	adoptionCards,
	attentionCards,
	monthCards,
	type StatisticsLinks,
	workforceCards,
} from "../settings/statistics/statistics-cards";
import {
	StatisticsAllClear,
	StatisticsCards,
	StatisticsGroup,
	StatisticsGroupError,
	StatisticsGroupSkeleton,
} from "../settings/statistics/statistics-groups";

async function groupLoadError() {
	const t = await getTranslate();
	return (
		<StatisticsGroupError
			message={t(
				"settings.statistics.groupLoadError",
				"Couldn't load these figures. Reload the page to try again.",
			)}
		/>
	);
}

async function AttentionSection({
	authContext,
	organizationId,
	canReviewOrganization,
}: {
	authContext: AuthContext;
	organizationId: string;
	canReviewOrganization: boolean;
}) {
	const [t, locale, result, approvals] = await Promise.all([
		getTranslate(),
		getLocale(),
		getAttentionStatistics(),
		loadApprovalInboxSummary(authContext, organizationId),
	]);
	const title = t("settings.statistics.sections.attention", "Needs attention");
	if (!result.success) {
		return (
			<StatisticsGroup id="attention" title={title}>
				{await groupLoadError()}
			</StatisticsGroup>
		);
	}
	const links: StatisticsLinks = {
		approvals: approvals.status === "ok" && approvals.value !== null,
		payrollReadiness: canReviewOrganization,
		workPolicies: canReviewOrganization,
	};
	const { cards, allClear } = attentionCards(result.data, approvals, links, {
		t,
		locale,
	});
	return (
		<StatisticsGroup id="attention" title={title}>
			{allClear ? (
				<StatisticsAllClear
					message={t(
						"settings.statistics.allClear",
						"All clear: nothing needs your attention right now.",
					)}
				/>
			) : (
				<StatisticsCards cards={cards} />
			)}
		</StatisticsGroup>
	);
}

async function MonthSection() {
	const [t, locale, result] = await Promise.all([
		getTranslate(),
		getLocale(),
		getMonthStatistics(),
	]);
	const title = t("settings.statistics.sections.thisMonth", "This month");
	return (
		<StatisticsGroup id="month" title={title}>
			{result.success ? (
				<StatisticsCards cards={monthCards(result.data, { t, locale })} />
			) : (
				await groupLoadError()
			)}
		</StatisticsGroup>
	);
}

async function AdoptionSection() {
	const [t, locale, result] = await Promise.all([
		getTranslate(),
		getLocale(),
		getAdoptionStatistics(),
	]);
	const title = t("settings.statistics.sections.adoption", "Tracking adoption");
	return (
		<StatisticsGroup id="adoption" title={title}>
			{result.success ? (
				<StatisticsCards cards={adoptionCards(result.data, { t, locale })} />
			) : (
				await groupLoadError()
			)}
		</StatisticsGroup>
	);
}

async function WorkforceSection({ organizationWide }: { organizationWide: boolean }) {
	const [t, locale, result] = await Promise.all([
		getTranslate(),
		getLocale(),
		getWorkforceStatistics(),
	]);
	const title = t("settings.statistics.sections.workforce", "Workforce & setup");
	return (
		<StatisticsGroup id="workforce" title={title}>
			{result.success ? (
				<StatisticsCards cards={workforceCards(result.data, { organizationWide }, { t, locale })} />
			) : (
				await groupLoadError()
			)}
		</StatisticsGroup>
	);
}

export function AnalyticsHealthSkeleton() {
	return (
		<div className="space-y-8">
			<StatisticsGroupSkeleton cards={3} />
			<StatisticsGroupSkeleton cards={3} heading="w-28" />
			<StatisticsGroupSkeleton cards={3} heading="w-40" />
			<StatisticsGroupSkeleton cards={4} heading="w-44" />
		</div>
	);
}

export async function AnalyticsHealthSections() {
	const [settingsRouteContext, caller, scopeResult, t] = await Promise.all([
		getCurrentSettingsRouteContext(),
		getCurrentSettingsAccess(),
		getStatisticsScope(),
		getTranslate(),
	]);

	if (
		!settingsRouteContext ||
		!caller ||
		caller.settingsAccess === null ||
		!meetsSettingsAccess(caller.settingsAccess, "scopedManager")
	) {
		return null;
	}

	if (!scopeResult.success) {
		return (
			<Alert variant="destructive">
				<IconAlertCircle aria-hidden="true" />
				<AlertTitle>{t("settings.statistics.loadError", "Failed to load statistics")}</AlertTitle>
				<AlertDescription>
					<p>{t("settings.statistics.loadErrorRetry", "Reload the page to try again.")}</p>
				</AlertDescription>
			</Alert>
		);
	}

	const canReviewOrganization = meetsSettingsAccess(caller.settingsAccess, "orgAdmin");

	return (
		<div className="space-y-8">
			<Suspense fallback={<StatisticsGroupSkeleton cards={3} />}>
				<AttentionSection
					authContext={settingsRouteContext.authContext}
					organizationId={caller.organizationId}
					canReviewOrganization={canReviewOrganization}
				/>
			</Suspense>
			<Suspense fallback={<StatisticsGroupSkeleton cards={3} heading="w-28" />}>
				<MonthSection />
			</Suspense>
			<Suspense fallback={<StatisticsGroupSkeleton cards={3} heading="w-40" />}>
				<AdoptionSection />
			</Suspense>
			<Suspense fallback={<StatisticsGroupSkeleton cards={4} heading="w-44" />}>
				<WorkforceSection organizationWide={scopeResult.data.scope.organizationWide} />
			</Suspense>
		</div>
	);
}
