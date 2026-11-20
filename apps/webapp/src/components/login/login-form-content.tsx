"use client";

import { IconFingerprint, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import dynamic from "next/dynamic";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { withCallbackUrl } from "@/lib/auth/callback-url";
import { AuthFormWrapper } from "../auth-form-wrapper";
import type { TurnstileRef } from "../turnstile-widget";
import { LoginAlternativeAuth } from "./alternative-auth";
import { LoginCredentialsFields } from "./credentials-fields";
import { LoginActions } from "./login-actions";
import { LoginVerification } from "./login-verification";
import { useLoginArrival, useLoginAuth } from "./use-login-auth";

const TwoFactorForm = dynamic(() => import("./two-factor-form").then((mod) => mod.TwoFactorForm), {
	ssr: false,
});

export function LoginFormContent(props: React.ComponentProps<"div">) {
	const arrival = useLoginArrival();
	return <LoginFormArrival key={arrival.scope} arrival={arrival} {...props} />;
}

function LoginFormArrival({
	arrival,
	className,
	...props
}: React.ComponentProps<"div"> & { arrival: ReturnType<typeof useLoginArrival> }) {
	const { t } = useTranslate();
	const turnstileRef = useRef<TurnstileRef>(null);
	const auth = useLoginAuth(turnstileRef, arrival);
	return (
		<AuthFormWrapper
			className={className}
			formProps={{ onSubmit: auth.handleSubmit, "aria-busy": auth.isLoading }}
			title={
				auth.requires2FA
					? t("auth.signIn.secondFactor", "Verify your sign-in")
					: t("auth.login-to-account", "Login to your account")
			}
			branding={auth.branding}
			{...props}
		>
			{auth.error ? (
				<div
					className="break-words rounded-md border border-destructive/30 bg-destructive/10 p-3 text-destructive text-sm"
					role="alert"
				>
					{auth.error}
				</div>
			) : null}
			{auth.showSSO && !auth.requires2FA ? (
				<Button
					type="button"
					className="h-auto min-h-11 w-full whitespace-normal"
					onClick={auth.handleSSOLogin}
					disabled={auth.isLoading}
				>
					{auth.pendingMethod === "sso" ? (
						<IconLoader2
							aria-hidden="true"
							className="size-4 animate-spin motion-reduce:animate-none"
						/>
					) : (
						<IconFingerprint aria-hidden="true" className="size-4" />
					)}
					{auth.pendingMethod === "sso"
						? t("auth.signIn.ssoPending", "Connecting to SSO…")
						: t("auth.login-with-sso", "Sign in with SSO")}
				</Button>
			) : null}
			{auth.showSSO && auth.showEmailPassword && !auth.requires2FA ? (
				<p className="border-t pt-5 text-center text-sm text-muted-foreground">
					{t("auth.signIn.credentials", "Sign in with email")}
				</p>
			) : null}
			{auth.showEmailPassword ? (
				<LoginCredentialsFields
					form={auth.form}
					disabled={auth.requires2FA || auth.isLoading}
					onChange={auth.handleFieldChange}
				/>
			) : null}
			{auth.requires2FA ? (
				<auth.form.Field name="otpValue">
					{(field) => (
						<TwoFactorForm
							otpValue={field.state.value}
							fieldError={field.state.meta.errors
								.filter((error) => typeof error === "string")
								.join(" ")}
							trustDevice={auth.trustDevice}
							isLoading={auth.isLoading}
							onOtpChange={auth.setOtpValue}
							onTrustDeviceChange={auth.setTrustDevice}
						/>
					)}
				</auth.form.Field>
			) : null}
			{auth.showEmailPassword && !auth.requires2FA ? (
				<LoginVerification key={auth.verificationNonce} auth={auth} widgetRef={turnstileRef} />
			) : null}
			<LoginActions
				requires2FA={auth.requires2FA}
				showEmailPassword={auth.showEmailPassword}
				isLoading={auth.isLoading}
				emailPending={auth.pendingMethod === "email"}
				turnstile={{ config: auth.turnstileConfig, token: auth.turnstileToken }}
				forgotPasswordHref="/forgot-password"
				signUpHref={withCallbackUrl("/sign-up", auth.callbackUrl)}
				showSignUp={auth.showSignUp}
			>
				<LoginAlternativeAuth
					requires2FA={auth.requires2FA}
					showPasskey={auth.showPasskey}
					filteredProviders={auth.filteredProviders}
					providersLoading={auth.providersLoading}
					providersError={auth.providersError}
					pendingMethod={auth.pendingMethod}
					isLoading={auth.isLoading}
					onPasskeyLogin={auth.handlePasskeyLogin}
					onSocialLogin={auth.handleSocialLogin}
				/>
			</LoginActions>
		</AuthFormWrapper>
	);
}
