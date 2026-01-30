import { eq } from "drizzle-orm";
import { PasskeyManagement } from "@/components/settings/passkey-management";
import { PasswordChangeForm } from "@/components/settings/password-change-form";
import { SessionManagement } from "@/components/settings/session-management";
import { SocialAccounts } from "@/components/settings/social-accounts";
import { TwoFactorSetup } from "@/components/settings/two-factor-setup";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { requireUser } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";

export default async function SecuritySettingsPage() {
	const [authContext, t] = await Promise.all([requireUser(), getTranslate()]);

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
					<SocialAccounts />
					<SessionManagement />
				</div>
			</div>
		</div>
	);
}
