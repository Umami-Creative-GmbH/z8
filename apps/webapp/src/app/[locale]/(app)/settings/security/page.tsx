import { eq } from "drizzle-orm";
import { PasskeyManagement } from "@/components/settings/passkey-management";
import { PasswordChangeForm } from "@/components/settings/password-change-form";
import { SessionManagement } from "@/components/settings/session-management";
import { SocialAccounts } from "@/components/settings/social-accounts";
import { TwoFactorSetup } from "@/components/settings/two-factor-setup";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { requireUser } from "@/lib/auth-helpers";
import type { SocialProviderId } from "@/lib/social-providers";
import { getTranslate } from "@/tolgee/server";

function getEnabledSocialProviderIds(): SocialProviderId[] {
	const providers: SocialProviderId[] = [];

	if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
		providers.push("google");
	}

	if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
		providers.push("github");
	}

	if (process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET) {
		providers.push("linkedin");
	}

	if (process.env.APPLE_CLIENT_ID && process.env.APPLE_CLIENT_SECRET) {
		providers.push("apple");
	}

	return providers;
}

export default async function SecuritySettingsPage() {
	const [authContext, t] = await Promise.all([requireUser(), getTranslate()]);
	const enabledSocialProviderIds = getEnabledSocialProviderIds();

	// Fetch user's 2FA status
	const userRecord = await db.query.user.findFirst({
		where: eq(user.id, authContext.user.id),
	});

	return (
		<div className="p-6">
			<div className="mx-auto max-w-2xl">
				<div className="mb-6">
					<h1 className="text-2xl font-semibold">
						{t("settings.security.title", "Security Settings")}
					</h1>
					<p className="text-muted-foreground">
						{t(
							"settings.security.description",
							"Manage your password, two-factor authentication, passkeys, and active sessions",
						)}
					</p>
				</div>
				<div className="space-y-6">
					<PasswordChangeForm />
					<TwoFactorSetup
						isEnabled={userRecord?.twoFactorEnabled ?? false}
						userEmail={authContext.user.email}
					/>
					<PasskeyManagement />
					<SocialAccounts enabledProviderIds={enabledSocialProviderIds} />
					<SessionManagement />
				</div>
			</div>
		</div>
	);
}
