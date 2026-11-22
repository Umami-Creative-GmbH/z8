import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache, type ReactNode, Suspense } from "react";
import { AppSkipLink } from "@/components/app-skip-link";
import { BillingRecoveryHeader } from "@/components/billing/billing-recovery-header";
import { TrialBanner } from "@/components/billing/trial-banner";
import { PushPermissionProvider } from "@/components/notifications/push-permission-provider";
import { OfflineBanner } from "@/components/offline";
import { OrganizationDeletionBanner } from "@/components/organization/organization-deletion-banner";
import { MfaDeadlineBanner } from "@/components/organization-mfa/deadline-banner";
import { PositionConsentDialogHost } from "@/components/position-capture/position-consent-dialog";
import { PostHogProvider } from "@/components/posthog-provider";
import { OrganizationSettingsProvider } from "@/components/providers/organization-settings-provider";
import { UserPreferencesProvider } from "@/components/providers/user-preferences-provider";
import { ServerSidebarRegion } from "@/components/server-sidebar-region";
import { SiteHeader } from "@/components/site-header";
import { GetTheAppBanner } from "@/components/store-app/get-the-app-banner";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { subscription } from "@/db/schema";
import { env } from "@/env";
import {
	getRenderApprovedMembership,
	getRenderOrganizationDisplayContext,
	getRenderSettingsAccess,
	getRenderUserOrganizations,
} from "@/lib/auth/render-context";
import { getRenderSession } from "@/lib/auth/render-session";
import { runtime } from "@/lib/effect/runtime";
import type { BillingAccessResult } from "@/lib/effect/services/billing/billing-enforcement.service";
import { createLogger } from "@/lib/logger";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { canCreateOrganizationsForDeployment } from "@/lib/organization/creation-policy.server";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access-level";
import { mfaChallengeFromSession } from "@/lib/organization-mfa/http";
import { appBannerScrollPaddingClassName } from "@/lib/store-app/app-banner";
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
const checkBillingAccess = cache(async (organizationId: string): Promise<BillingAccessResult> => {
	const { BillingEnforcementService, BillingServicesLive } =
		await import("@/lib/effect/services/billing");
	return runtime.runPromise(
		Effect.flatMap(BillingEnforcementService, (enforcementService) =>
			enforcementService.checkBillingAccess(organizationId),
		).pipe(Effect.provide(BillingServicesLive)),
	);
});

interface AuthenticatedAppContentProps {
	children: ReactNode;
	params: Promise<{ locale: string }>;
}

function SiteHeaderLoading() {
	return (
		<header className="box-content flex h-(--header-height) shrink-0 items-center border-b bg-card px-4 pt-[env(safe-area-inset-top)] lg:px-6">
			<Skeleton className="h-5 w-40" />
			<div className="ml-auto flex items-center gap-2">
				<Skeleton className="size-8 rounded-md" />
				<Skeleton className="size-8 rounded-md" />
				<Skeleton className="size-8 rounded-md" />
			</div>
		</header>
	);
}

async function requireAppSession(
	session: Awaited<ReturnType<typeof getRenderSession>>,
	headersList: Headers,
	locale: string,
) {
	if (!session?.user) {
		// Session cookie exists but is invalid - redirect to session-expired handler
		// which properly clears cookies before redirecting to sign-in.
		// This prevents redirect loops when proxy sees cookie but session is invalid.
		const pathname = headersList.get(DOMAIN_HEADERS.PATHNAME) || `/${locale}`;
		const sessionExpiredUrl = `/api/auth/session-expired?locale=${locale}&callbackUrl=${encodeURIComponent(pathname)}`;
		redirect(sessionExpiredUrl);
	}

	const mfaChallenge = mfaChallengeFromSession(session);
	if (mfaChallenge)
		return redirectWithLocale(
			`/mfa?organizationId=${encodeURIComponent(mfaChallenge.organizationId)}`,
		);
	if ("ssoRequired" in session && session.ssoRequired === true) {
		const callbackUrl = headersList.get(DOMAIN_HEADERS.PATHNAME) || `/${locale}`;
		const query = new URLSearchParams({ callbackUrl });
		const organizationId = session.session?.activeOrganizationId;
		if (organizationId) query.set("organizationId", organizationId);
		return redirectWithLocale(`/init?${query}`);
	}
	return session;
}

export async function AuthenticatedAppContent({ children, params }: AuthenticatedAppContentProps) {
	// Auth database instrumentation uses random trace IDs and must run per request.
	await connection();
	// Centralized auth check protects all routes in the (app) group.
	const [{ locale }, headersList, rawSession] = await Promise.all([
		params,
		headers(),
		getRenderSession(),
	]);

	const session = await requireAppSession(rawSession, headersList, locale);
	const activeOrganizationId = session.session?.activeOrganizationId;
	// Sync DB locale preference on load (null = user hasn't set preference, respect browser/cookie)
	const [preferences, organizationContext] = await Promise.all([
		getRenderUserPreferences(session.user.id),
		getRenderOrganizationDisplayContext(),
	]);
	const { locale: dbLocale, weekStartDay, timeFormat, timezone, helpImproveProduct } = preferences;
	if (dbLocale && dbLocale !== locale) {
		// User has a saved locale preference that differs from current URL - redirect
		const pathname = headersList.get(DOMAIN_HEADERS.PATHNAME) || `/${locale}`;
		const newPath = pathname.replace(`/${locale}`, `/${dbLocale}`);
		const search = headersList.get(DOMAIN_HEADERS.SEARCH) || "";
		redirect(`${newPath}${search}`);
	}

	const pathname = headersList.get(DOMAIN_HEADERS.PATHNAME) || `/${locale}`;
	const { billingAccess, trialDaysRemaining, canManageBilling, showTrialBanner } =
		await loadAppBillingStatus(activeOrganizationId);
	const isBillingRecoveryPath =
		pathname === `/${locale}/settings/billing` ||
		pathname.startsWith(`/${locale}/settings/billing/`) ||
		pathname === `/${locale}/billing/suspended` ||
		pathname.startsWith(`/${locale}/billing/suspended/`);

	if (billingAccess.canAccess === false && !isBillingRecoveryPath) {
		return redirectWithLocale("/billing/suspended");
	}

	const isSuspendedRecoveryMode = billingAccess.canAccess === false;
	const recoveryChrome = isSuspendedRecoveryMode
		? await Promise.all([getRenderUserOrganizations(), getRenderSettingsAccess()]).then(
				([organizations, settingsAccess]) => ({
					organizations,
					currentOrganization: activeOrganizationId
						? (organizations.find((org) => org.id === activeOrganizationId) ?? null)
						: null,
					canCreateOrganizations: canCreateOrganizationsForDeployment(
						Boolean(
							("canCreateOrganizations" in session.user && session.user.canCreateOrganizations) ||
							session.user.role === "admin",
						),
					),
					canAccessBilling: meetsSettingsAccess(settingsAccess, "orgAdmin"),
				}),
			)
		: null;

	return (
		<PostHogProvider
			identityKey={JSON.stringify([session.user.id, activeOrganizationId])}
			disabled={env.NODE_ENV === "development"}
			helpImproveProduct={helpImproveProduct}
		>
			<PushPermissionProvider>
				<UserPreferencesProvider
					weekStartDay={weekStartDay}
					timeFormat={timeFormat}
					timezone={timezone}
				>
					<OrganizationSettingsProvider initialContext={organizationContext}>
						{recoveryChrome ? (
							<div className="flex min-h-svh flex-1 flex-col bg-background">
								<AppSkipLink />
								<BillingRecoveryHeader
									organizations={recoveryChrome.organizations}
									currentOrganization={recoveryChrome.currentOrganization}
									canCreateOrganizations={recoveryChrome.canCreateOrganizations}
									canAccessBilling={recoveryChrome.canAccessBilling}
								/>
								<div
									className="flex min-h-0 flex-1 flex-col overflow-y-auto"
									id="app-page-content"
									tabIndex={-1}
								>
									{children}
								</div>
							</div>
						) : (
							<SidebarProvider
								style={
									{
										"--sidebar-width": "16rem",
										"--sidebar-width-icon": "3.5rem",
										"--header-height": "4rem",
									} as React.CSSProperties
								}
							>
								<AppSkipLink />
								<ServerSidebarRegion
									variant="sidebar"
									showWorksCouncilNav={Boolean(activeOrganizationId)}
								/>
								<SidebarInset>
									<Suspense fallback={<SiteHeaderLoading />}>
										<SiteHeader />
									</Suspense>
									{/* In flow so recovery status never covers header clock controls. */}
									<OfflineBanner />
									<Suspense fallback={null}>
										<MfaDeadlineBanner
											userId={session.user.id}
											organizationId={activeOrganizationId}
										/>
									</Suspense>
									<AppTrialBanner
										showTrialBanner={showTrialBanner}
										trialDaysRemaining={trialDaysRemaining}
										canManageBilling={canManageBilling}
									/>
									<OrganizationDeletionBanner />
									{/* Asked on the next clock action when position capture needs consent (#826). */}
									<PositionConsentDialogHost />
									{/* Keeps the end of each page above the home indicator when drawn edge to edge, and above the get-the-app banner while it shows (#847). */}
									<div
										className={`flex flex-1 flex-col min-h-0 overflow-y-auto ${appBannerScrollPaddingClassName}`}
										id="app-page-content"
										tabIndex={-1}
									>
										{children}
									</div>
									{/* Floats over the page on phone browsers, so it never shifts the layout (#847). */}
									<GetTheAppBanner
										storeUrls={{
											ios: env.STORE_APP_IOS_URL ?? null,
											android: env.STORE_APP_ANDROID_URL ?? null,
										}}
									/>
								</SidebarInset>
							</SidebarProvider>
						)}
					</OrganizationSettingsProvider>
				</UserPreferencesProvider>
			</PushPermissionProvider>
		</PostHogProvider>
	);
}

function AppTrialBanner({
	showTrialBanner,
	trialDaysRemaining,
	canManageBilling,
}: Pick<
	Awaited<ReturnType<typeof loadAppBillingStatus>>,
	"showTrialBanner" | "trialDaysRemaining" | "canManageBilling"
>) {
	if (!showTrialBanner || trialDaysRemaining === null) {
		return null;
	}

	return (
		<TrialBanner
			daysRemaining={trialDaysRemaining}
			billingHref="/settings/billing"
			showUpgradeButton={canManageBilling}
		/>
	);
}

async function loadAppBillingStatus(activeOrganizationId: string | null | undefined) {
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
					getRenderApprovedMembership(),
					db.query.subscription.findFirst({
						where: eq(subscription.organizationId, activeOrganizationId),
					}),
				])
			: [null, null];

	const trialDaysRemaining =
		typeof billingAccess.daysRemaining === "number" && billingAccess.daysRemaining > 0
			? billingAccess.daysRemaining
			: null;
	const membershipRole = membershipRecord?.role;
	const canManageBilling = membershipRole === "owner" || membershipRole === "admin";
	const hasPreparedTrialSubscription =
		subscriptionRow?.status === "trialing" && Boolean(subscriptionRow?.stripeSubscriptionId);
	const showTrialBanner =
		billingAccess.state === "trialing" &&
		trialDaysRemaining !== null &&
		!hasPreparedTrialSubscription;

	return {
		billingAccess,
		trialDaysRemaining,
		canManageBilling,
		showTrialBanner,
	};
}

/** Per-request cached billing access shared between the app and nested settings layouts. */
export const getRenderBillingAccess = cache(async (): Promise<BillingAccessResult> => {
	const billingEnabled = env.BILLING_ENABLED === "true";
	if (!billingEnabled) {
		return billingDisabledAccess;
	}
	const session = await getRenderSession();
	const activeOrganizationId = session?.session?.activeOrganizationId;
	if (!activeOrganizationId) {
		return billingDisabledAccess;
	}
	return checkBillingAccess(activeOrganizationId).catch((error) => {
		logger.error({ error, organizationId: activeOrganizationId }, "Billing access check failed");
		return billingCheckFailedAccess;
	});
});
