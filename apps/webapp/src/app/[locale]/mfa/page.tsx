import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { Suspense } from "react";
import { MfaSignOut } from "@/components/organization-mfa/sign-out";
import { MfaVerification } from "@/components/organization-mfa/verification";
import { PasskeyManagement } from "@/components/settings/auth/passkey-management";
import { TwoFactorSetup } from "@/components/settings/auth/two-factor-setup";
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
	return (
		<main className="mx-auto max-w-2xl space-y-8 px-5 py-10">
			<h1 className="text-2xl font-semibold">
				{t("mfa.page.title", "Security verification")}
			</h1>
			<p>
				{t(
					"mfa.page.context",
					"Personal enrollment, recovery and organization selection remain available while organization access needs verification.",
				)}
			</p>
			<ul className="space-y-3">
				{requirements.map((requirement) => (
					<li
						key={requirement.organizationId}
						className="rounded-lg border p-3"
					>
						<strong>{requirement.organizationName}</strong>
						<p>
							{requirement.deadlineLabel ??
								t("mfa.deadline.required", "Verification required now")}
						</p>
						<p>
							{requirement.enforced
								? t(
										"mfa.deadline.enforced",
										"An authenticator must be verified before organization access.",
									)
								: t(
										"mfa.deadline.grace",
										"Enrollment window in progress. Verify an authenticator before this deadline.",
									)}
						</p>
					</li>
				))}
			</ul>
			<MfaVerification
				organizationId={organizationId}
				hasPassword={credentials.length > 0}
				socialProviders={socialProviders}
				callbackUrl={sanitizeCallbackUrl(query.callbackUrl, "")}
			/>
			<section className="space-y-4 border-t pt-6">
				<h2 className="text-lg font-medium">
					{t("mfa.enrollment.title", "Enroll or replace an authenticator")}
				</h2>
				<p>
					{t(
						"mfa.enrollment.warning",
						"Adding or replacing a factor needs verification within five minutes. Verify the replacement before removing the old factor. Revoking your last factor is allowed and can block access to the organizations listed above; it does not grant a new enrollment window.",
					)}
				</p>
				{credentials.length > 0 && (
					<TwoFactorSetup
						isEnabled={person.twoFactorEnabled ?? false}
						userEmail={subject.user.email}
					/>
				)}
				<PasskeyManagement />
			</section>
			<p>
				{t(
					"mfa.recovery.lockout",
					"If a sole administrator loses every authentication and recovery route, the organization stays locked. There is no administrator or support bypass.",
				)}
			</p>
			<nav className="flex gap-4">
				<Link href="/init">
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
			<Suspense fallback={null}>
				<SecurityVerification searchParams={searchParams} />
			</Suspense>
		</RouteTranslationBoundary>
	);
}
