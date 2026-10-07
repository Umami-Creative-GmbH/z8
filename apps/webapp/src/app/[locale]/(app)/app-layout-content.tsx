import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { type ReactNode, Suspense } from "react";
import { TrialBanner } from "@/components/billing/trial-banner";
import { PushPermissionProvider } from "@/components/notifications/push-permission-provider";
import { OfflineBanner } from "@/components/offline";
import { OrganizationDeletionBanner } from "@/components/organization/organization-deletion-banner";
import { PostHogProvider } from "@/components/posthog-provider";
import { OrganizationSettingsProvider } from "@/components/providers/organization-settings-provider";
import { UserPreferencesProvider } from "@/components/providers/user-preferences-provider";
import { ServerAppSidebar } from "@/components/server-app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import { subscription } from "@/db/schema";
import { env } from "@/env";
import { getRenderSession } from "@/lib/auth/render-session";
import { runtime } from "@/lib/effect/runtime";
import type { BillingAccessResult } from "@/lib/effect/services/billing/billing-enforcement.service";
import { createLogger } from "@/lib/logger";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { getOrganizationSettings } from "@/lib/organization-settings";
import { getRenderUserPreferences } from "@/lib/user-preferences/render-snapshot";
import { DOMAIN_HEADERS } from "@/proxy";

const logger = createLogger("app-layout");
const billingDisabledAccess: BillingAccessResult = {
	canAccess: true,
	state: "disabled",
};
const billingCheckFailedAccess: BillingAccessResult = {
	canAccess: false,
	state: "suspended",
	reason: "subscription_required",
	status: "billing_check_failed",
};

/** Billing runs on the shared runtime; it is imported only once billing is enabled. */
async function checkBillingAccess(organizationId: string): Promise<BillingAccessResult> {
	const { BillingEnforcementService, BillingServicesLive } = await import(
		"@/lib/effect/services/billing"
	);
	return runtime.runPromise(
		Effect.flatMap(BillingEnforcementService, (enforcementService) =>
			enforcementService.checkBillingAccess(organizationId),
		).pipe(Effect.provide(BillingServicesLive)),
	);
}

interface AuthenticatedAppContentProps {
	children: ReactNode;
	params: Promise<{ locale: string }>;
}

function SiteHeaderLoading() {
	return (
		<header className="flex h-(--header-height) shrink-0 items-center border-b px-4 lg:px-6">
			<Skeleton className="h-5 w-40" />
			<div className="ml-auto flex items-center gap-2">
				<Skeleton className="size-8 rounded-md" />
				<Skeleton className="size-8 rounded-md" />
				<Skeleton className="size-8 rounded-md" />
			</div>
		</header>
	);
}

export async function AuthenticatedAppContent({
	children,
	params,
}: AuthenticatedAppContentProps) {
	// Auth database instrumentation uses random trace IDs and must run per request.
	await connection();
	const [{ locale }, headersList] = await Promise.all([params, headers()]);

	// Centralized auth check - protects all routes in the (app) group
	const session = await getRenderSession();

	if (!session?.user) {
		// Session cookie exists but is invalid - redirect to session-expired handler
		// which properly clears cookies before redirecting to sign-in.
		// This prevents redirect loops when proxy sees cookie but session is invalid.
		const pathname = headersList.get(DOMAIN_HEADERS.PATHNAME) || `/${locale}`;
		const sessionExpiredUrl = `/api/auth/session-expired?locale=${locale}&callbackUrl=${encodeURIComponent(pathname)}`;
		redirect(sessionExpiredUrl);
	}

	const activeOrganizationId = session.session?.activeOrganizationId;
	// Sync DB locale preference on load (null = user hasn't set preference, respect browser/cookie)
	const [preferences, organizationSettings] = await Promise.all([
		getRenderUserPreferences(session.user.id),
		getOrganizationSettings(activeOrganizationId, session.user.id),
	]);
	const {
		locale: dbLocale,
		weekStartDay,
		timeFormat,
		timezone,
		helpImproveProduct,
	} = preferences;
	if (dbLocale && dbLocale !== locale) {
		// User has a saved locale preference that differs from current URL - redirect
		const pathname = headersList.get(DOMAIN_HEADERS.PATHNAME) || `/${locale}`;
		const newPath = pathname.replace(`/${locale}`, `/${dbLocale}`);
		redirect(newPath);
	}

	const billingEnabled = env.BILLING_ENABLED === "true";
	const billingAccess =
		activeOrganizationId && billingEnabled
			? await checkBillingAccess(activeOrganizationId).catch((error) => {
					logger.error(
						{ error, organizationId: activeOrganizationId },
						"Billing access check failed",
					);

					return billingCheckFailedAccess;
				})
			: billingDisabledAccess;
	const [membershipRecord, subscriptionRow] =
		activeOrganizationId && billingEnabled
			? await Promise.all([
					db.query.member.findFirst({
						where: and(
							eq(member.userId, session.user.id),
							eq(member.organizationId, activeOrganizationId),
						),
					}),
					db.query.subscription.findFirst({
						where: eq(subscription.organizationId, activeOrganizationId),
					}),
				])
			: [null, null];
	const pathname = headersList.get(DOMAIN_HEADERS.PATHNAME) || `/${locale}`;
	const isBillingRecoveryPath =
		pathname === `/${locale}/settings/billing` ||
		pathname.startsWith(`/${locale}/settings/billing/`) ||
		pathname === `/${locale}/billing/suspended` ||
		pathname.startsWith(`/${locale}/billing/suspended/`);

	if (billingAccess.canAccess === false && !isBillingRecoveryPath) {
		return redirectWithLocale("/billing/suspended");
	}

	const trialDaysRemaining =
		typeof billingAccess.daysRemaining === "number" &&
		billingAccess.daysRemaining > 0
			? billingAccess.daysRemaining
			: null;
	const membershipRole = membershipRecord?.role;
	const canManageBilling =
		membershipRole === "owner" || membershipRole === "admin";
	const hasPreparedTrialSubscription =
		subscriptionRow?.status === "trialing" &&
		Boolean(subscriptionRow?.stripeSubscriptionId);
	const showTrialBanner =
		billingAccess.state === "trialing" &&
		trialDaysRemaining !== null &&
		!hasPreparedTrialSubscription;

	return (
		<PostHogProvider
			disabled={env.NODE_ENV === "development"}
			helpImproveProduct={helpImproveProduct}
		>
			<PushPermissionProvider>
				<UserPreferencesProvider
					weekStartDay={weekStartDay}
					timeFormat={timeFormat}
					timezone={timezone}
				>
					<OrganizationSettingsProvider initialSettings={organizationSettings}>
						<SidebarProvider
							style={
								{
									"--sidebar-width": "calc(var(--spacing) * 72)",
									"--header-height": "calc(var(--spacing) * 12)",
								} as React.CSSProperties
							}
						>
							<ServerAppSidebar
								variant="inset"
								showWorksCouncilNav={Boolean(activeOrganizationId)}
							/>
							<SidebarInset>
								<Suspense fallback={<SiteHeaderLoading />}>
									<SiteHeader />
								</Suspense>
								{/* In flow so recovery status never covers header clock controls. */}
								<OfflineBanner />
								{showTrialBanner ? (
									<TrialBanner
										daysRemaining={trialDaysRemaining}
										billingHref="/settings/billing"
										showUpgradeButton={canManageBilling}
									/>
								) : null}
								<OrganizationDeletionBanner />
								<div className="flex flex-1 flex-col min-h-0 overflow-y-auto">
									{children}
								</div>
							</SidebarInset>
						</SidebarProvider>
					</OrganizationSettingsProvider>
				</UserPreferencesProvider>
			</PushPermissionProvider>
		</PostHogProvider>
	);
}
