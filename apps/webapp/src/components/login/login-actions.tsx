"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import type { ReactNode, Ref } from "react";
import { Button } from "@/components/ui/button";
import type { TurnstileConfig } from "@/lib/domain";
import { Link } from "@/navigation";
import { type TurnstileRef, TurnstileWidget } from "../turnstile-widget";

export type LoginActionsTurnstileProps = {
	config: TurnstileConfig | null;
	token: string | null;
	ref: Ref<TurnstileRef>;
	onVerify: (token: string) => void;
	onError: () => void;
	onExpire: () => void;
	onTimeout: () => void;
};

export type LoginActionsProps = {
	requires2FA: boolean;
	showEmailPassword: boolean;
	isLoading: boolean;
	turnstile: LoginActionsTurnstileProps;
	forgotPasswordHref: string;
	signUpHref: string;
	children: ReactNode;
};

export function LoginActions({
	requires2FA,
	showEmailPassword,
	isLoading,
	turnstile,
	forgotPasswordHref,
	signUpHref,
	children,
}: LoginActionsProps) {
	const { t } = useTranslate();

	return (
		<>
			{!requires2FA && showEmailPassword && (
				<>
					{turnstile.config?.enabled && turnstile.config.siteKey && (
						<TurnstileWidget
							ref={turnstile.ref}
							siteKey={turnstile.config.siteKey}
							onVerify={turnstile.onVerify}
							onError={turnstile.onError}
							onExpire={turnstile.onExpire}
							onTimeout={turnstile.onTimeout}
							className="!absolute !overflow-hidden !size-0"
						/>
					)}
					<Button
						className="w-full"
						disabled={isLoading || (turnstile.config?.enabled && !turnstile.token)}
						type="submit"
					>
						{isLoading ? (
							<>
								<IconLoader2 className="size-4 animate-spin" />
								{t("auth.logging-in", "Logging in...")}
							</>
						) : (
							t("auth.login", "Login")
						)}
					</Button>
					<div className="-mt-6 text-center">
						<Link className="text-xs underline-offset-2 hover:underline" href={forgotPasswordHref}>
							{t("auth.forgot-password", "Forgot your password?")}
						</Link>
					</div>
				</>
			)}
			{children}
			{!requires2FA && showEmailPassword && (
				<div className="text-center text-sm">
					{t("auth.dont-have-account", "Don't have an account?")}{" "}
					<Link className="underline underline-offset-4" href={signUpHref}>
						{t("auth.sign-up", "Sign up")}
					</Link>
				</div>
			)}
		</>
	);
}
