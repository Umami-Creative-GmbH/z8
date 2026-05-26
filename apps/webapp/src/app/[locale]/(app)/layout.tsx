import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { TrialBanner } from "@/components/billing/trial-banner";
import { PushPermissionProvider } from "@/components/notifications/push-permission-provider";
import { OrganizationDeletionBanner } from "@/components/organization/organization-deletion-banner";
import { OrganizationSettingsProvider } from "@/components/providers/organization-settings-provider";
import { UserPreferencesProvider } from "@/components/providers/user-preferences-provider";
import { ServerAppSidebar } from "@/components/server-app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import { subscription } from "@/db/schema";
import { env } from "@/env";
import { auth } from "@/lib/auth";
import { getUserLocaleRaw } from "@/lib/bot-platform/i18n";
import {
	type BillingAccessResult,
	BillingEnforcementService,
	BillingEnforcementServiceLive,
} from "@/lib/effect/services/billing/billing-enforcement.service";
import { createLogger } from "@/lib/logger";
import { getUserTimeFormat } from "@/lib/user-preferences/time-format-server";
import { getUserWeekStartDay } from "@/lib/user-preferences/week-start-server";
import { DOMAIN_HEADERS } from "@/proxy";

const logger = createLogger("app-layout");
const billingDisabledAccess: BillingAccessResult = { canAccess: true, state: "disabled" };
const billingCheckFailedAccess: BillingAccessResult = {
	canAccess: false,
	state: "suspended",
	reason: "subscription_required",
	status: "billing_check_failed",
};

interface AppLayoutProps {
	children: ReactNode;
	params: Promise<{ locale: string }>;
}

export default async function AppLayout({ children, params }: AppLayoutProps) {
	const [{ locale }, headersList] = await Promise.all([params, headers()]);

	// Centralized auth check - protects all routes in the (app) group
	const session = await auth.api.getSession({ headers: headersList });

	if (!session?.user) {
		// Session cookie exists but is invalid - redirect to session-expired handler
		// which properly clears cookies before redirecting to sign-in.
		// This prevents redirect loops when proxy sees cookie but session is invalid.
		const pathname = headersList.get(DOMAIN_HEADERS.PATHNAME) || `/${locale}`;
		const sessionExpiredUrl = `/api/auth/session-expired?locale=${locale}&callbackUrl=${encodeURIComponent(pathname)}`;
		redirect(sessionExpiredUrl);
	}

	// Sync DB locale preference on load (null = user hasn't set preference, respect browser/cookie)
	const [dbLocale, weekStartDay, timeFormat] = await Promise.all([
		getUserLocaleRaw(session.user.id),
		getUserWeekStartDay(session.user.id),
		getUserTimeFormat(session.user.id),
	]);
	if (dbLocale && dbLocale !== locale) {
		// User has a saved locale preference that differs from current URL — redirect
		const pathname = headersList.get(DOMAIN_HEADERS.PATHNAME) || `/${locale}`;
		const newPath = pathname.replace(`/${locale}`, `/${dbLocale}`);
		redirect(newPath);
	}

	const billingEnabled = env.BILLING_ENABLED === "true";
	const activeOrganizationId = session.session?.activeOrganizationId;
	const billingAccess =
		activeOrganizationId && billingEnabled
			? await Effect.runPromise(
					Effect.gen(function* () {
						const enforcementService = yield* BillingEnforcementService;

						return yield* enforcementService.checkBillingAccess(activeOrganizationId);
					}).pipe(Effect.provide(BillingEnforcementServiceLive)),
				).catch((error) => {
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
		redirect(`/${locale}/billing/suspended`);
	}

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

	return (
		<PushPermissionProvider>
			<UserPreferencesProvider weekStartDay={weekStartDay} timeFormat={timeFormat}>
				<OrganizationSettingsProvider>
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
							<SiteHeader />
							{showTrialBanner ? (
								<TrialBanner
									daysRemaining={trialDaysRemaining}
									billingHref="/settings/billing"
									showUpgradeButton={canManageBilling}
								/>
							) : null}
							<OrganizationDeletionBanner />
							<div className="flex flex-1 flex-col min-h-0 overflow-y-auto">{children}</div>
						</SidebarInset>
					</SidebarProvider>
				</OrganizationSettingsProvider>
			</UserPreferencesProvider>
		</PushPermissionProvider>
	);
}
