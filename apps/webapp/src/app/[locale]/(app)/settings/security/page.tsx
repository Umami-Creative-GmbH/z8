import { IconAlertTriangle } from "@tabler/icons-react";
import { eq } from "drizzle-orm";
import { Link } from "@/navigation";
import { PasskeyManagement } from "@/components/settings/auth/passkey-management";
import { PasswordChangeForm } from "@/components/settings/auth/password-change-form";
import { SessionManagement } from "@/components/settings/auth/session-management";
import { SocialAccounts } from "@/components/settings/auth/social-accounts";
import { TwoFactorSetup } from "@/components/settings/auth/two-factor-setup";
import { OwnKioskFobCard } from "@/components/settings/kiosk/own-kiosk-fob-card";
import { OwnKioskPinCard } from "@/components/settings/kiosk/own-kiosk-pin-card";
import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { env } from "@/env";
import { getCurrentSettingsAccess, requireUser } from "@/lib/auth-helpers";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access-level";
import type { SocialProviderId } from "@/lib/social-providers";
import { getTranslate } from "@/tolgee/server";

function getEnabledSocialProviderIds(): SocialProviderId[] {
	const providers: SocialProviderId[] = [];

	if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
		providers.push("google");
	}

	if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
		providers.push("github");
	}

	if (env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET) {
		providers.push("linkedin");
	}

	if (env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET) {
		providers.push("apple");
	}

	return providers;
}

export default async function SecuritySettingsPage() {
	const [authContext, t, settingsAccessCaller] = await Promise.all([
		requireUser(),
		getTranslate(),
		// Only decides whether to show the policy link; the policy page authorizes on its own.
		// A failed lookup hides the link rather than failing the personal security page.
		getCurrentSettingsAccess().catch(() => null),
	]);
	const enabledSocialProviderIds = getEnabledSocialProviderIds();
	const canManageOrganizationPolicy = meetsSettingsAccess(
		settingsAccessCaller?.settingsAccess ?? null,
		"orgAdmin",
	);

	// Fetch user's 2FA status
	const userRecord = await db.query.user.findFirst({
		where: eq(user.id, authContext.user.id),
	});

	return (
		<div className="page-frame">
			<div className="page-measure space-y-6">
				<PageHeader
					title={t("settings.security.title", "Security Settings")}
					description={t(
						"settings.security.description",
						"Manage your password, two-factor authentication, passkeys, and active sessions",
					)}
				/>
				<div className="flex gap-3 rounded-lg border bg-muted/40 p-4 text-sm">
					<IconAlertTriangle
						className="mt-0.5 size-4 shrink-0 text-muted-foreground"
						aria-hidden="true"
					/>
					<div className="min-w-0 space-y-2">
						<p>
							{t(
								"mfa.security.factorWarning",
								"Removing a factor can block access to organizations that require it. Verify a replacement first; removing the last factor does not grant new grace.",
							)}
						</p>
						<ul className="space-y-1">
							<li>
								<Link
									href="/mfa"
									className="font-medium text-primary underline-offset-4 hover:underline"
								>
									{t(
										"mfa.security.link",
										"Verify authentication and review organization requirements",
									)}
								</Link>
							</li>
							{canManageOrganizationPolicy ? (
								<li>
									<Link
										href="/settings/enterprise/identity-setup?tab=local-mfa"
										className="font-medium text-primary underline-offset-4 hover:underline"
									>
										{t(
											"mfa.security.policyLink",
											"Organization authentication policy (owners/admins)",
										)}
									</Link>
								</li>
							) : null}
						</ul>
					</div>
				</div>
				<PasswordChangeForm />
				<TwoFactorSetup
					variant="card"
					isEnabled={userRecord?.twoFactorEnabled ?? false}
					userEmail={authContext.user.email}
				/>
				<PasskeyManagement variant="card" />
				<OwnKioskPinCard />
				<OwnKioskFobCard />
				<SocialAccounts enabledProviderIds={enabledSocialProviderIds} />
				<SessionManagement />
			</div>
		</div>
	);
}
