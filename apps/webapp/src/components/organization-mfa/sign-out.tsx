"use client";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
export function MfaSignOut() {
	const { t } = useTranslate();
	return (
		<Button
			variant="outline"
			onClick={async () => {
				await authClient.signOut();
				window.location.href = "/sign-in";
			}}
		>
			{t("mfa.signout", "Sign out")}
		</Button>
	);
}
