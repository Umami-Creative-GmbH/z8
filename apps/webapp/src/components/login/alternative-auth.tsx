"use client";

import { IconKey, IconLoader2 } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import type { SocialProvider, SocialProviderId } from "@/lib/social-providers";

export type LoginAlternativeAuthProps = {
	requires2FA: boolean;
	showPasskey: boolean;
	filteredProviders: SocialProvider[];
	providersLoading: boolean;
	providersError?: Error | null;
	pendingMethod?: string | null;
	isLoading: boolean;
	onPasskeyLogin: () => void;
	onSocialLogin: (provider: SocialProviderId) => void;
};

export function LoginAlternativeAuth({
	requires2FA,
	showPasskey,
	filteredProviders,
	providersLoading,
	providersError,
	pendingMethod,
	isLoading,
	onPasskeyLogin,
	onSocialLogin,
}: LoginAlternativeAuthProps) {
	const { t } = useTranslate();
	if (
		requires2FA ||
		(!showPasskey && filteredProviders.length === 0 && !providersLoading && !providersError)
	)
		return null;
	return (
		<section
			className="grid min-w-0 gap-3 border-t pt-5"
			aria-label={t("auth.or-continue-with", "Or continue with")}
		>
			<p className="text-center text-sm text-muted-foreground">
				{t("auth.or-continue-with", "Or continue with")}
			</p>
			{showPasskey ? (
				<Button
					type="button"
					variant="outline"
					className="h-auto min-h-11 w-full whitespace-normal"
					onClick={onPasskeyLogin}
					disabled={isLoading}
				>
					{pendingMethod === "passkey" ? (
						<IconLoader2
							aria-hidden="true"
							className="size-4 animate-spin motion-reduce:animate-none"
						/>
					) : (
						<IconKey aria-hidden="true" className="size-4" />
					)}
					{t("auth.login-with.passkey", "Login with Passkey")}
				</Button>
			) : null}
			{providersLoading ? (
				<p role="status" className="text-center text-sm text-muted-foreground">
					{t("auth.signIn.methodsLoading", "Loading sign-in methods…")}
				</p>
			) : null}
			{providersError ? (
				<div className="grid gap-2 text-center">
					<p role="alert" className="text-sm text-destructive">
						{t("auth.signIn.methodsUnavailable", "Other sign-in methods could not be loaded.")}
					</p>
					<RetrySignInMethods disabled={isLoading || providersLoading} />
				</div>
			) : null}
			<div className="grid min-w-0 gap-2 sm:grid-cols-2">
				{filteredProviders.map((provider) => (
					<Button
						key={provider.id}
						type="button"
						variant="outline"
						className="h-auto min-h-11 w-full whitespace-normal"
						onClick={() => onSocialLogin(provider.id)}
						disabled={isLoading || providersLoading}
					>
						{pendingMethod === provider.id ? (
							<IconLoader2
								aria-hidden="true"
								className="size-4 animate-spin motion-reduce:animate-none"
							/>
						) : (
							<provider.icon aria-hidden="true" className="size-4" />
						)}
						{t(`auth.login-with.${provider.id}`, `Login with ${provider.name}`)}
					</Button>
				))}
			</div>
		</section>
	);
}

function RetrySignInMethods({ disabled }: { disabled: boolean }) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	return (
		<Button
			type="button"
			variant="outline"
			className="whitespace-normal"
			disabled={disabled}
			onClick={() => {
				void queryClient.invalidateQueries({ queryKey: ["auth", "providers"] });
			}}
		>
			{t("auth.signIn.retryMethods", "Retry sign-in methods")}
		</Button>
	);
}
