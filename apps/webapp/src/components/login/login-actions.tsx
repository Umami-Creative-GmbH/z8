"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { TurnstileConfig } from "@/lib/domain";
import { Link } from "@/navigation";

export type LoginActionsTurnstileProps = {
	config: TurnstileConfig | null;
	token: string | null;
};

export type LoginActionsProps = {
	requires2FA: boolean;
	showEmailPassword: boolean;
	isLoading: boolean;
	emailPending?: boolean;
	turnstile: LoginActionsTurnstileProps;
	forgotPasswordHref: string;
	signUpHref: string;
	children: ReactNode;
};

export function LoginActions({
	requires2FA,
	showEmailPassword,
	isLoading,
	emailPending = isLoading,
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
					<Button
						className="w-full"
						disabled={isLoading || (turnstile.config?.enabled && !turnstile.token)}
						type="submit"
					>
						{emailPending ? (
							<>
								<IconLoader2
									aria-hidden="true"
									className="size-4 animate-spin motion-reduce:animate-none"
								/>
								{t("auth.logging-in", "Logging in...")}
							</>
						) : (
							t("auth.login", "Login")
						)}
					</Button>
					<div className="text-center">
						<Link
							className="inline-flex min-h-9 items-center text-sm underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
							href={forgotPasswordHref}
						>
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
