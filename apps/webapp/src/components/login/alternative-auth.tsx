"use client";

import { IconKey } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SocialProvider, SocialProviderId } from "@/lib/social-providers";

const SOCIAL_SKELETON_KEYS = ["social-1", "social-2", "social-3", "social-4", "social-5", "social-6"];

export type LoginAlternativeAuthProps = {
	requires2FA: boolean;
	showPasskey: boolean;
	filteredProviders: SocialProvider[];
	providersLoading: boolean;
	isLoading: boolean;
	onPasskeyLogin: () => void;
	onSocialLogin: (provider: SocialProviderId) => void;
};

export function LoginAlternativeAuth({
	requires2FA,
	showPasskey,
	filteredProviders,
	providersLoading,
	isLoading,
	onPasskeyLogin,
	onSocialLogin,
}: LoginAlternativeAuthProps) {
	const { t } = useTranslate();

	if (requires2FA || (!showPasskey && filteredProviders.length === 0)) {
		return null;
	}

	const skeletonCount = Math.max(filteredProviders.length, 4);

	return (
		<>
			<div className="text-center text-sm">
				<span className="relative z-10 px-2 text-muted-foreground">
					{t("auth.or-continue-with", "Or continue with")}
				</span>
			</div>
			<div className="flex flex-wrap justify-center gap-2 *:w-1/4">
				{showPasskey && (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button type="button" variant="outline" onClick={onPasskeyLogin} disabled={isLoading}>
								<IconKey className="size-4" />
								<span className="sr-only">{t("auth.login-with.passkey", "Login with Passkey")}</span>
							</Button>
						</TooltipTrigger>
						<TooltipContent>
							<span className="text-sm">{t("auth.login-with.passkey", "Login with Passkey")}</span>
						</TooltipContent>
					</Tooltip>
				)}

				{providersLoading
					? SOCIAL_SKELETON_KEYS.slice(0, skeletonCount).map((key) => (
							<div key={key} className="h-10 animate-pulse rounded-md bg-muted" />
						))
					: filteredProviders.map((provider) => (
							<Tooltip key={provider.id}>
								<TooltipTrigger asChild>
									<Button
										type="button"
										variant="outline"
										onClick={() => onSocialLogin(provider.id)}
										disabled={isLoading}
									>
										<provider.icon className="size-4" />
										<span className="sr-only">
											{t(`auth.login-with.${provider.id}`, `Login with ${provider.name}`)}
										</span>
									</Button>
								</TooltipTrigger>
								<TooltipContent>
									<span className="text-sm">
										{t(`auth.login-with.${provider.id}`, `Login with ${provider.name}`)}
									</span>
								</TooltipContent>
							</Tooltip>
						))}
			</div>
		</>
	);
}
