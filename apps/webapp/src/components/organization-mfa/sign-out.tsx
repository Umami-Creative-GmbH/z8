"use client";
import { useTranslate } from "@tolgee/react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
export function MfaSignOut() {
	const { t } = useTranslate();
	const running = useRef(false);
	const [pending, setPending] = useState(false);
	const [failed, setFailed] = useState(false);
	return (
		<div className="space-y-2">
			<Button
				variant="outline"
				disabled={pending}
				aria-busy={pending}
				onClick={async () => {
					if (running.current) return;
					running.current = true;
					setPending(true);
					setFailed(false);
					const result = await authClient.signOut().catch(() => null);
					running.current = false;
					setPending(false);
					if (result && !result.error) window.location.href = "/sign-in";
					else setFailed(true);
				}}
			>
				{t("mfa.signout", "Sign out")}
			</Button>
			{failed && (
				<p role="alert" className="text-sm text-destructive">
					{t("mfa.signout.failed", "Sign-out failed. Try again.")}
				</p>
			)}
		</div>
	);
}
