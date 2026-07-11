"use client";

import { IconFingerprint } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import { withCallbackUrl } from "@/lib/auth/callback-url";
import { AuthFormWrapper } from "../auth-form-wrapper";
import { TurnstileWidget } from "../turnstile-widget";
import { LoginActions } from "./login-actions";
import { LoginAlternativeAuth } from "./alternative-auth";
import { LoginCredentialsFields } from "./credentials-fields";
import { TwoFactorForm } from "./two-factor-form";
import { useLoginAuth } from "./use-login-auth";

export function LoginFormContent({ className, ...props }: React.ComponentProps<"div">) {
	const { t } = useTranslate();
	const auth = useLoginAuth();

	return (
		<AuthFormWrapper
			className={className}
			formProps={{ onSubmit: auth.handleSubmit }}
			title={t("auth.login-to-account", "Login to your account")}
			branding={auth.branding}
			{...props}
		>
			{auth.error ? (
				<div className="rounded-md bg-destructive/15 p-3 text-destructive text-sm">{auth.error}</div>
			) : null}
			{auth.showSSO && !auth.requires2FA ? (
				<Button type="button" className="w-full" onClick={auth.handleSSOLogin} disabled={auth.isLoading}>
					<IconFingerprint className="mr-2 size-4" />
					{t("auth.login-with-sso", "Sign in with SSO")}
				</Button>
			) : null}
			{auth.showSSO && auth.showEmailPassword && !auth.requires2FA ? (
				<div className="relative">
					<div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
					<div className="relative flex justify-center text-xs uppercase">
						<span className="bg-card px-2 text-muted-foreground">{t("auth.or", "or")}</span>
					</div>
				</div>
			) : null}
			{auth.showEmailPassword ? (
				<LoginCredentialsFields
					email={auth.email}
					password={auth.password}
					fieldErrors={auth.fieldErrors}
					requires2FA={auth.requires2FA}
					onEmailBlur={auth.handleEmailBlur}
					onEmailChange={auth.handleEmailChange}
					onPasswordBlur={auth.handlePasswordBlur}
					onPasswordChange={auth.handlePasswordChange}
				/>
			) : null}
			{auth.requires2FA ? (
				<TwoFactorForm
					otpValue={auth.otpValue}
					trustDevice={auth.trustDevice}
					isLoading={auth.isLoading}
					onOtpChange={auth.setOtpValue}
					onTrustDeviceChange={auth.setTrustDevice}
					onVerify={auth.handleVerify2FA}
				/>
			) : null}
			<LoginActions
				requires2FA={auth.requires2FA}
				showEmailPassword={auth.showEmailPassword}
				isLoading={auth.isLoading}
				turnstile={{
					config: auth.turnstileConfig,
					token: auth.turnstileToken,
				}}
				forgotPasswordHref="/forgot-password"
				signUpHref={withCallbackUrl("/sign-up", auth.callbackUrl)}
			>
				{auth.turnstileConfig?.enabled && auth.turnstileConfig.siteKey ? (
					<TurnstileWidget
						ref={auth.setTurnstileRef}
						siteKey={auth.turnstileConfig.siteKey}
						onVerify={auth.handleTurnstileVerify}
						onError={auth.handleTurnstileError}
						onExpire={auth.handleTurnstileExpire}
						onTimeout={auth.handleTurnstileTimeout}
						className="!absolute !overflow-hidden !size-0"
					/>
				) : null}
				<LoginAlternativeAuth
					requires2FA={auth.requires2FA}
					showPasskey={auth.showPasskey}
					filteredProviders={auth.filteredProviders}
					providersLoading={auth.providersLoading}
					isLoading={auth.isLoading}
					onPasskeyLogin={auth.handlePasskeyLogin}
					onSocialLogin={auth.handleSocialLogin}
				/>
			</LoginActions>
		</AuthFormWrapper>
	);
}
