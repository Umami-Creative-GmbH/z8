import { IconAlertCircle, IconArrowRight } from "@tabler/icons-react";
import { getLocale } from "next-intl/server";
import { Suspense } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { LoadingRegion } from "@/components/ui/loading-region";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { type AuthContext, getAuthContext, getCurrentSettingsAccess } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access-level";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";
import {
	getAdoptionStatistics,
	getAttentionStatistics,
	getMonthStatistics,
	getStatisticsScope,
	getWorkforceStatistics,
} from "./actions";
import { loadApprovalInboxSummary } from "./approval-inbox-summary";
import {
	adoptionCards,
	attentionCards,
	monthCards,
	type StatisticsLinks,
	workforceCards,
} from "./statistics-cards";
import { formatStatisticsFetchedAt } from "./statistics-format";
import {
	StatisticsAllClear,
	StatisticsCards,
	StatisticsGroup,
	StatisticsGroupError,
	StatisticsGroupSkeleton,
} from "./statistics-groups";

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
	const { cards, allClear } = attentionCards(result.data, approvals, links, { t, locale });
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

async function StatisticsContent() {
	const [authContext, caller, t, locale] = await Promise.all([
		getAuthContext(),
		getCurrentSettingsAccess(),
		getTranslate(),
		getLocale(),
	]);

	if (
		!authContext ||
		!caller?.settingsAccess ||
		caller.organizationId !== authContext.session.activeOrganizationId ||
		!meetsSettingsAccess(caller.settingsAccess, "scopedManager")
	) {
		return redirectWithLocale("/settings");
	}

	const { organizationId, settingsAccess } = caller;

	const [scopeResult, organizationTimezone] = await Promise.all([
		getStatisticsScope(),
		// "Last updated" is shown in the organization's time zone, the one "this month" counts in;
		// the label names the zone, so a failed read falls back to UTC visibly.
		loadOrganizationTimezone(db, organizationId).catch(() => "UTC"),
	]);

	const title = t("settings.statistics.title", "Statistics");
	const description = t(
		"settings.statistics.healthDescription",
		"Whether Z8 is working well for your organization: what needs attention, how this month is going, and how well tracking is set up.",
	);

	if (!scopeResult.success) {
		return (
			<div className="page-frame flex flex-1 flex-col gap-6">
				<PageHeader title={title} description={description} />
				<Alert variant="destructive">
					<IconAlertCircle aria-hidden="true" />
					<AlertTitle>{t("settings.statistics.loadError", "Failed to load statistics")}</AlertTitle>
					<AlertDescription>
						<p>{t("settings.statistics.loadErrorRetry", "Reload the page to try again.")}</p>
					</AlertDescription>
				</Alert>
			</div>
		);
	}

	const { scope, fetchedAt } = scopeResult.data;
	const scopeLabel = scope.organizationWide
		? t("settings.statistics.scope.organization", "Whole organization")
		: t(
				"settings.statistics.scope.teams",
				"{count, plural, =0 {No teams you manage} one {# team you manage} other {# teams you manage}}",
				{ count: scope.teamCount },
			);
	// Payroll readiness and work-policy violations are org-admin settings.
	const canReviewOrganization = meetsSettingsAccess(settingsAccess, "orgAdmin");
	// The analytics pages check the employee role, not settings access.
	const canOpenAnalytics =
		authContext.employee?.organizationId === organizationId &&
		(authContext.employee.role === "admin" || authContext.employee.role === "manager");

	return (
		<div className="page-frame flex flex-1 flex-col gap-8">
			<PageHeader
				title={title}
				description={description}
				actions={
					<div className="space-y-1 text-right text-xs">
						<p className="font-medium text-foreground">{scopeLabel}</p>
						<p className="tabular-nums text-muted-foreground">
							{t("settings.statistics.lastUpdated", "Last updated")}:{" "}
							<time dateTime={fetchedAt}>
								{formatStatisticsFetchedAt(fetchedAt, locale, organizationTimezone)}
							</time>
						</p>
					</div>
				}
			/>

			<Suspense fallback={<StatisticsGroupSkeleton cards={3} />}>
				<AttentionSection
					authContext={authContext}
					organizationId={organizationId}
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
				<WorkforceSection organizationWide={scope.organizationWide} />
			</Suspense>

			{canOpenAnalytics ? (
				<p className="text-sm">
					<Link
						href="/analytics"
						className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline focus-visible:underline"
					>
						{t("settings.statistics.analyticsLink", "See trends and breakdowns in Analytics")}
						<IconArrowRight aria-hidden className="size-4" />
					</Link>
				</p>
			) : null}
		</div>
	);
}

function StatisticsLoading() {
	return (
		<LoadingRegion
			className="page-frame flex flex-1 flex-col gap-8"
			label={{
				labelKey: "common.loadingRegions.statistics",
				labelDefault: "Loading statistics",
			}}
		>
			<div className="space-y-2">
				<Skeleton aria-hidden="true" className="h-8 w-48" />
				<Skeleton aria-hidden="true" className="h-4 w-96 max-w-full" />
			</div>
			<StatisticsGroupSkeleton cards={3} />
			<StatisticsGroupSkeleton cards={3} heading="w-28" />
			<StatisticsGroupSkeleton cards={3} heading="w-40" />
			<StatisticsGroupSkeleton cards={4} heading="w-44" />
		</LoadingRegion>
	);
}

export default function StatisticsPage() {
	return (
		<Suspense fallback={<StatisticsLoading />}>
			<StatisticsContent />
		</Suspense>
	);
}
