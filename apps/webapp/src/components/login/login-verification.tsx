"use client";

import { useTranslate } from "@tolgee/react";
import { useEffect, useRef } from "react";
import { type TurnstileRef, TurnstileWidget } from "@/components/turnstile-widget";
import { Button } from "@/components/ui/button";
import type { useLoginAuth } from "./use-login-auth";

export function LoginVerification({
	auth,
	widgetRef,
}: {
	auth: ReturnType<typeof useLoginAuth>;
	widgetRef: React.RefObject<TurnstileRef | null>;
}) {
	const { t } = useTranslate();
	const active = useRef(false);
	useEffect(() => {
		active.current = true;
		return () => {
			active.current = false;
		};
	}, []);
	const status =
		auth.verificationState === "ready"
			? t("auth.signIn.verification.ready", "Verification complete.")
			: auth.verificationState === "expired"
				? t("auth.signIn.verification.expired", "Verification expired. Please try again.")
				: auth.verificationState === "timeout"
					? t("auth.signIn.verification.timeout", "Verification timed out. Please try again.")
					: auth.verificationState === "error"
						? t(
								"auth.signIn.verification.error",
								"Verification could not complete. Please try again.",
							)
						: t("auth.signIn.verification.waiting", "Complete the verification to sign in.");
	if (!auth.turnstileConfig?.enabled || !auth.turnstileConfig.siteKey) return null;
	return (
		<div className="grid min-w-0 gap-3">
			<p role="status" className="text-sm text-muted-foreground">
				{status}
			</p>
			<TurnstileWidget
				ref={widgetRef}
				siteKey={auth.turnstileConfig.siteKey}
				size="flexible"
				onVerify={(token) => {
					if (active.current) auth.handleTurnstileVerify(token);
				}}
				onError={() => {
					if (active.current) auth.handleTurnstileError();
				}}
				onExpire={() => {
					if (active.current) auth.handleTurnstileExpire();
				}}
				onTimeout={() => {
					if (active.current) auth.handleTurnstileTimeout();
				}}
			/>
			{auth.verificationState !== "ready" ? (
				<Button
					type="button"
					variant="outline"
					className="w-full whitespace-normal"
					disabled={auth.isLoading}
					onClick={auth.retryVerification}
				>
					{t("auth.signIn.verification.retry", "Retry verification")}
				</Button>
			) : null}
		</div>
	);
}
