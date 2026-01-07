import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth-helpers";
import { PasswordChangeForm } from "@/components/settings/password-change-form";
import { SessionManagement } from "@/components/settings/session-management";
import { TwoFactorSetup } from "@/components/settings/two-factor-setup";
import { PasskeyManagement } from "@/components/settings/passkey-management";
import { SocialAccounts } from "@/components/settings/social-accounts";
import { db } from "@/db";
import { user } from "@/db/auth-schema";

export default async function SecuritySettingsPage() {
	const authContext = await requireUser();

	// Fetch user's 2FA status
	const userRecord = await db.query.user.findFirst({
		where: eq(user.id, authContext.user.id),
	});

	return (
		<div className="p-6">
			<div className="mx-auto max-w-2xl">
				<div className="mb-6">
					<h1 className="text-2xl font-semibold">Security Settings</h1>
					<p className="text-muted-foreground">
						Manage your password, two-factor authentication, passkeys, and active sessions
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
