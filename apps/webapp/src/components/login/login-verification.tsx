"use client";

import { useTranslate } from "@tolgee/react";
import { useEffect, useRef, useState } from "react";
import { type TurnstileRef, TurnstileWidget } from "@/components/turnstile-widget";
import { Button } from "@/components/ui/button";
import type { useLoginAuth } from "./use-login-auth";

/**
 * Turnstile runs in interaction-only mode, so most people never see it.
 * While it verifies in the background, or once it has passed, it stays out of
 * the layout with no text. It takes space only when Cloudflare asks for
 * interaction, or when verification failed and the person has to retry.
 * An expired token is reset and re-verified silently.
 */
export function LoginVerification({
	auth,
	widgetRef,
}: {
	auth: ReturnType<typeof useLoginAuth>;
	widgetRef: React.RefObject<TurnstileRef | null>;
}) {
	const { t } = useTranslate();
	const active = useRef(false);
	const [needsInteraction, setNeedsInteraction] = useState(false);
	useEffect(() => {
		active.current = true;
		return () => {
			active.current = false;
		};
	}, []);
	if (!auth.turnstileConfig?.enabled || !auth.turnstileConfig.siteKey) return null;
	const problem =
		auth.verificationState === "timeout"
			? t("auth.signIn.verification.timeout", "Verification timed out. Please try again.")
			: auth.verificationState === "error"
				? t("auth.signIn.verification.error", "Verification could not complete. Please try again.")
				: null;
	const visible = problem !== null || (needsInteraction && auth.verificationState !== "ready");
	return (
		<div
			className={
				visible ? "grid min-w-0 gap-3" : "pointer-events-none absolute size-0 overflow-hidden"
			}
			data-state={visible ? "visible" : "hidden"}
		>
			{problem ? (
				<p role="status" className="text-sm text-muted-foreground">
					{problem}
				</p>
			) : null}
			<TurnstileWidget
				ref={widgetRef}
				siteKey={auth.turnstileConfig.siteKey}
				size="flexible"
				onBeforeInteractive={() => {
					if (active.current) setNeedsInteraction(true);
				}}
				onVerify={(token) => {
					if (!active.current) return;
					setNeedsInteraction(false);
					auth.handleTurnstileVerify(token);
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
			{problem ? (
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
