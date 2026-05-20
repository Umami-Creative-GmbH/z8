import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Effect } from "effect";
import type { ReactNode } from "react";
import { TrialBanner } from "@/components/billing/trial-banner";
import { PushPermissionProvider } from "@/components/notifications/push-permission-provider";
import { OrganizationDeletionBanner } from "@/components/organization/organization-deletion-banner";
import { OrganizationSettingsProvider } from "@/components/providers/organization-settings-provider";
import { UserPreferencesProvider } from "@/components/providers/user-preferences-provider";
import { ServerAppSidebar } from "@/components/server-app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { auth } from "@/lib/auth";
import { getUserLocaleRaw } from "@/lib/bot-platform/i18n";
import {
	type BillingAccessResult,
	BillingEnforcementService,
	BillingEnforcementServiceLive,
} from "@/lib/effect/services/billing/billing-enforcement.service";
import { getUserTimeFormat } from "@/lib/user-preferences/time-format-server";
import { getUserWeekStartDay } from "@/lib/user-preferences/week-start-server";
import { DOMAIN_HEADERS } from "@/proxy";
import { setLanguage } from "@/tolgee/language";

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
		await setLanguage(dbLocale);
		const pathname = headersList.get(DOMAIN_HEADERS.PATHNAME) || `/${locale}`;
		const newPath = pathname.replace(`/${locale}`, `/${dbLocale}`);
		redirect(newPath);
	}

	const billingDisabledAccess: BillingAccessResult = { canAccess: true, state: "disabled" };
	const activeOrganizationId = session.session?.activeOrganizationId;
	const billingAccess = activeOrganizationId
		? await Effect.runPromise(
				Effect.gen(function* () {
					const enforcementService = yield* BillingEnforcementService;

					return yield* enforcementService.checkBillingAccess(activeOrganizationId);
				}).pipe(Effect.provide(BillingEnforcementServiceLive)),
			).catch(() => billingDisabledAccess)
		: billingDisabledAccess;
	const trialDaysRemaining =
		typeof billingAccess.daysRemaining === "number" && billingAccess.daysRemaining > 0
			? billingAccess.daysRemaining
			: null;
	const showTrialBanner =
		billingAccess.state === "trialing" &&
		trialDaysRemaining !== null;

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
						<ServerAppSidebar variant="inset" />
						<SidebarInset>
							<SiteHeader />
							{showTrialBanner ? (
								<TrialBanner
									daysRemaining={trialDaysRemaining}
									billingHref={`/${locale}/settings/billing`}
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
