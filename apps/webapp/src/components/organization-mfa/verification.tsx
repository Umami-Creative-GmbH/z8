"use client";

import { IconKey, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { authClient } from "@/lib/auth-client";
import type { SocialProviderId } from "@/lib/social-providers";

function VerificationField({
	name,
	label,
	action,
	requiredMessage,
	pending,
	verify,
	type = "text",
	autoComplete,
	inputMode,
}: {
	name: string;
	label: string;
	action: string;
	requiredMessage: string;
	pending: boolean;
	verify: (value: string) => Promise<boolean>;
	type?: "password" | "text";
	autoComplete: string;
	inputMode?: "numeric";
}) {
	const input = useRef<HTMLInputElement>(null);
	const form = useForm({
		defaultValues: { value: "" },
		onSubmitInvalid: () => input.current?.focus(),
		onSubmit: async ({ value }) => {
			if (!pending && (await verify(value.value))) form.reset();
		},
	});
	return (
		<form
			noValidate
			className="space-y-3"
			aria-busy={pending}
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				if (!pending) void form.handleSubmit();
			}}
		>
			<form.Field
				name="value"
				validators={{
					onSubmit: ({ value }) => (value.length ? undefined : requiredMessage),
				}}
			>
				{(field) => (
					<TFormItem>
						<TFormLabel>{label}</TFormLabel>
						<TFormControl hasError={field.state.meta.errors.length > 0}>
							<Input
								ref={input}
								name={name}
								type={type}
								autoComplete={autoComplete}
								inputMode={inputMode}
								spellCheck={false}
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(event) => field.handleChange(event.target.value)}
								disabled={pending}
							/>
						</TFormControl>
						<TFormDescription className="sr-only">
							{requiredMessage}
						</TFormDescription>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>
			<Button
				type="submit"
				disabled={pending}
				className="h-auto min-h-9 max-w-full whitespace-normal text-left"
			>
				{pending && (
					<IconLoader2
						aria-hidden="true"
						className="size-4 animate-spin motion-reduce:animate-none"
					/>
				)}
				{action}
			</Button>
		</form>
	);
}

export function MfaVerification({
	organizationId,
	hasPassword,
	socialProviders,
	callbackUrl,
	children,
}: {
	organizationId: string | null;
	hasPassword: boolean;
	socialProviders: SocialProviderId[];
	callbackUrl?: string;
	children?: ReactNode;
}) {
	const { t } = useTranslate();
	const [message, setMessage] = useState<{
		text: string;
		error: boolean;
		recovery?: boolean;
	} | null>(null);
	const [pending, setPending] = useState(false);
	const running = useRef(false);
	const active = useRef(true);
	useEffect(() => {
		active.current = true;
		return () => {
			active.current = false;
		};
	}, []);
	const run = async (work: () => Promise<void>, recovery = false) => {
		if (running.current) return false;
		running.current = true;
		setPending(true);
		setMessage(null);
		return Promise.resolve()
			.then(work)
			.then(
				() => true,
				(error: unknown) => {
					setMessage({
						text:
							error instanceof Error
								? error.message
								: t("mfa.verification.failed", "Verification failed"),
						error: true,
						recovery,
					});
					return false;
				},
			)
			.finally(() => {
				running.current = false;
				setPending(false);
			});
	};
	const continueToOrganization = () => {
		if (!active.current) return;
		const query = new URLSearchParams();
		if (organizationId) query.set("organizationId", organizationId);
		if (callbackUrl) query.set("callbackUrl", callbackUrl);
		window.location.href = `/init?${query}`;
	};
	const verifyPassword = (password: string) =>
		run(async () => {
			const response = await fetch(
				"/api/auth/organization-mfa/verify-password",
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ password }),
				},
			);
			if (!response.ok)
				throw new Error(
					t("mfa.password.failed", "Password verification failed"),
				);
			setMessage({
				text: t(
					"mfa.password.verified",
					"Password verified. You can enroll your first authenticator, or verify an existing authenticator or backup code below.",
				),
				error: false,
			});
		});
	return (
		<>
			<section
				className="space-y-5 rounded-xl border bg-card p-5 sm:p-6"
				aria-labelledby="mfa-verify-title"
			>
				<div className="space-y-2">
					<h2 id="mfa-verify-title" className="text-lg font-semibold">
						{t("mfa.verify.title", "Verify your sign-in")}
					</h2>
					<p className="text-sm text-muted-foreground">
						{t(
							"mfa.verify.description",
							"Verify an authenticator to return to your organization. Enrollment and remembered-device trust alone do not satisfy the requirement.",
						)}
					</p>
				</div>
				<VerificationField
					name="code"
					label={t("mfa.code.label", "Authenticator code")}
					action={t("mfa.code.verify", "Verify authenticator")}
					requiredMessage={t(
						"mfa.code.required",
						"Enter an authenticator code",
					)}
					pending={pending}
					autoComplete="one-time-code"
					inputMode="numeric"
					verify={(code) =>
						run(async () => {
							const result = await authClient.twoFactor.verifyTotp({
								code,
								trustDevice: false,
							});
							if (result.error) throw new Error(result.error.message);
							continueToOrganization();
						})
					}
				/>
				<Button
					variant="outline"
					disabled={pending}
					className="h-auto min-h-9 max-w-full whitespace-normal"
					onClick={() =>
						void run(async () => {
							const result = await authClient.signIn.passkey();
							if (result.error) throw new Error(result.error.message);
							continueToOrganization();
						})
					}
				>
					<IconKey aria-hidden="true" className="size-4" />
					{t("mfa.passkey.verify", "Verify with a passkey")}
				</Button>
				<details className="border-t pt-4">
					<summary className="cursor-pointer rounded-sm text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
						{t("mfa.alternatives.title", "Verify an existing sign-in")}
					</summary>
					<div className="mt-4 space-y-4">
						{hasPassword && (
							<VerificationField
								name="password"
								label={t("mfa.password.label", "Current password")}
								action={t("mfa.password.verify", "Verify password")}
								requiredMessage={t(
									"mfa.password.required",
									"Enter your current password",
								)}
								pending={pending}
								type="password"
								autoComplete="current-password"
								verify={verifyPassword}
							/>
						)}
						<div className="flex flex-wrap gap-2">
							{socialProviders.map((provider) => (
								<Button
									key={provider}
									variant="outline"
									disabled={pending}
									className="h-auto min-h-9 max-w-full whitespace-normal"
									onClick={() =>
										void run(async () => {
											const result = await authClient.signIn.social({
												provider,
												callbackURL: window.location.href,
											});
											if (result.error) throw new Error(result.error.message);
										})
									}
								>
									{t(
										"mfa.social.verify",
										"Verify existing sign-in with {provider}",
										{ provider },
									)}
								</Button>
							))}
							{organizationId && (
								<Button
									variant="outline"
									disabled={pending}
									className="h-auto min-h-9 max-w-full whitespace-normal"
									onClick={() =>
										void run(async () => {
											const response = await fetch("/api/organizations/sso", {
												method: "POST",
												headers: { "content-type": "application/json" },
												body: JSON.stringify({
													organizationId,
													callbackUrl:
														window.location.pathname + window.location.search,
												}),
											});
											const result = await response.json();
											if (!response.ok || !result.url)
												throw new Error(
													t(
														"mfa.sso.failed",
														"Organization SSO could not be started",
													),
												);
											window.location.href = result.url;
										})
									}
								>
									{t("mfa.sso.verify", "Verify with organization SSO")}
								</Button>
							)}
						</div>
					</div>
				</details>
				{message && !message.recovery && (
					<p
						role={message.error ? "alert" : "status"}
						aria-live="polite"
						className={
							message.error
								? "text-sm text-destructive"
								: "text-sm text-muted-foreground"
						}
					>
						{message.text}
					</p>
				)}
				<Button
					variant="outline"
					disabled={pending}
					className="h-auto min-h-9 max-w-full whitespace-normal"
					onClick={continueToOrganization}
				>
					{t("mfa.continue", "Continue after verification")}
				</Button>
			</section>
			{children}
			<section
				className="space-y-4 border-t pt-6"
				aria-labelledby="mfa-recovery-title"
			>
				<h2 id="mfa-recovery-title" className="text-lg font-semibold">
					{t("mfa.recovery.title", "Account recovery")}
				</h2>
				<p className="text-sm text-muted-foreground">
					{t(
						"mfa.recovery.lockout",
						"If a sole administrator loses every authentication and recovery route, the organization stays locked. There is no administrator or support bypass.",
					)}
				</p>
				{hasPassword && (
					<details>
						<summary className="cursor-pointer rounded-sm text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
							{t("mfa.recovery.open", "Recover with a backup code")}
						</summary>
						<div className="mt-4 space-y-4">
							<p className="text-sm text-muted-foreground">
								{t(
									"mfa.recovery.description",
									"For recovery, verify your password above and then enter one unused backup code. This clears prior local verification across your organizations.",
								)}
							</p>
							<VerificationField
								name="backupCode"
								label={t("mfa.recovery.label", "Backup code")}
								action={t("mfa.recovery.action", "Recover with backup code")}
								requiredMessage={t(
									"mfa.recovery.required",
									"Enter an unused backup code",
								)}
								pending={pending}
								autoComplete="off"
								verify={(code) =>
									run(async () => {
										const result = await authClient.twoFactor.verifyBackupCode({
											code,
										});
										if (result.error) throw new Error(result.error.message);
										setMessage({
											text: t(
												"mfa.recovery.success",
												"Recovery permits replacement enrollment only. Verify an authenticator before returning to your organization.",
											),
											error: false,
											recovery: true,
										});
									}, true)
								}
							/>
						</div>
					</details>
				)}
				{message?.recovery && (
					<p
						role={message.error ? "alert" : "status"}
						aria-live="polite"
						className={
							message.error
								? "text-sm text-destructive"
								: "text-sm text-muted-foreground"
						}
					>
						{message.text}
						{!message.error && (
							<>
								{" "}
								{t(
									"mfa.recovery.nextSteps",
									"Verify your password again before verifying an authenticator.",
								)}
							</>
						)}
					</p>
				)}
			</section>
		</>
	);
}
