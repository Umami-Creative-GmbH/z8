import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { MfaRequirements } from "@/components/organization-mfa/requirements";
import { MfaSignOut } from "@/components/organization-mfa/sign-out";
import { MfaVerification } from "@/components/organization-mfa/verification";
import { PasskeyManagement } from "@/components/settings/auth/passkey-management";
import { TwoFactorSetup } from "@/components/settings/auth/two-factor-setup";
import { LoadingRegion } from "@/components/ui/loading-region";
import { PageHeader } from "@/components/ui/page-header";
import { pageSafeAreaPaddingClassName } from "@/components/ui/safe-area";
import { db } from "@/db";
import { account, user } from "@/db/auth-schema";
import { env } from "@/env";
import { sanitizeCallbackUrl } from "@/lib/auth/callback-url";
import { getRequestSession } from "@/lib/auth/request-session";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { getOwnMfaRequirements } from "@/lib/organization-mfa/queries";
import type { SocialProviderId } from "@/lib/social-providers";
import { RouteTranslationBoundary } from "@/tolgee/route-boundary";
import { getTranslate } from "@/tolgee/server";

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslate();

	return {
		title: t("mfa.page.title", "Security verification"),
		description: t(
			"mfa.page.description",
			"Verify an authenticator to keep access to your organizations.",
		),
	};
}

async function SecurityVerification({
	searchParams,
}: {
	searchParams: Promise<{ organizationId?: string; callbackUrl?: string }>;
}) {
	const subject = await getRequestSession();
	if (!subject?.user) return redirectWithLocale("/sign-in");
	const [query, requirements, [person], credentials, t] = await Promise.all([
		searchParams,
		getOwnMfaRequirements(subject.user.id),
		db
			.select({ twoFactorEnabled: user.twoFactorEnabled })
			.from(user)
			.where(eq(user.id, subject.user.id)),
		db
			.select({ id: account.id })
			.from(account)
			.where(
				and(
					eq(account.userId, subject.user.id),
					eq(account.providerId, "credential"),
				),
			),
		getTranslate(),
	]);
	const socialProviders: SocialProviderId[] = [];
	if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
		socialProviders.push("google");
	if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET)
		socialProviders.push("github");
	if (env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET)
		socialProviders.push("apple");
	if (env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET)
		socialProviders.push("linkedin");
	const organizationId =
		query.organizationId ?? requirements[0]?.organizationId ?? null;
	const callbackUrl = sanitizeCallbackUrl(query.callbackUrl, "");
	const selectedOrganization = requirements.find(
		(requirement) => requirement.organizationId === organizationId,
	);
	return (
		<main
			className={`mx-auto min-h-svh max-w-3xl space-y-7 break-words bg-background px-5 py-10 sm:px-8 ${pageSafeAreaPaddingClassName}`}
		>
			<header className="space-y-5">
				<p className="text-sm font-semibold text-primary" translate="no">
					Z8
				</p>
				<PageHeader
					title={t("mfa.page.title", "Security verification")}
					scope={selectedOrganization?.organizationName}
					description={t(
						"mfa.page.context",
						"Personal enrollment, recovery and organization selection remain available while organization access needs verification.",
					)}
				/>
			</header>
			<MfaRequirements
				requirements={requirements}
				organizationId={organizationId}
				callbackUrl={callbackUrl}
			/>
			<MfaVerification
				key={`${subject.user.id}:${organizationId}`}
				organizationId={organizationId}
				hasPassword={credentials.length > 0}
				socialProviders={socialProviders}
				callbackUrl={callbackUrl}
			>
				<section className="space-y-5" aria-labelledby="mfa-enrollment-title">
					<h2 id="mfa-enrollment-title" className="text-lg font-semibold">
						{t("mfa.enrollment.title", "Enroll or replace an authenticator")}
					</h2>
					<p className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
						{t(
							"mfa.enrollment.warning",
							"Adding or replacing a factor needs verification within five minutes. Verify the replacement before removing the old factor. Revoking your last factor is allowed and can block access to the organizations listed above; it does not grant a new enrollment window.",
						)}
					</p>
					{credentials.length > 0 && (
						<TwoFactorSetup
							isEnabled={person?.twoFactorEnabled ?? false}
							userEmail={subject.user.email}
						/>
					)}
					<div className="min-w-0 border-t pt-5">
						<PasskeyManagement />
					</div>
				</section>
			</MfaVerification>
			<nav
				className="flex flex-wrap items-center justify-between gap-4 border-t pt-5"
				aria-label={t("mfa.navigation", "Organization and account")}
			>
				<Link
					href="/init"
					className="rounded-sm text-sm font-medium underline underline-offset-4 hover:text-primary focus-visible:outline-2 focus-visible:outline-ring"
				>
					{t("mfa.organization.select", "Select another organization")}
				</Link>
				<MfaSignOut />
			</nav>
		</main>
	);
}
export default function MfaPage({
	searchParams,
	params,
}: {
	searchParams: Promise<{ organizationId?: string; callbackUrl?: string }>;
	params: Promise<{ locale: string }>;
}) {
	return (
		<RouteTranslationBoundary route="/mfa" params={params}>
			<Suspense
				fallback={
					<LoadingRegion
						label={{
							labelKey: "mfa.loading",
							labelDefault: "Loading security verification",
						}}
						className="mx-auto max-w-3xl px-5 py-10"
					/>
				}
			>
				<SecurityVerification searchParams={searchParams} />
			</Suspense>
		</RouteTranslationBoundary>
	);
}
