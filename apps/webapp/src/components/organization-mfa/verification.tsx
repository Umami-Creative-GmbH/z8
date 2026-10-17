"use client";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import type { SocialProviderId } from "@/lib/social-providers";

export function MfaVerification({
	organizationId,
	hasPassword,
	socialProviders,
	callbackUrl,
}: {
	organizationId: string | null;
	hasPassword: boolean;
	socialProviders: SocialProviderId[];
	callbackUrl?: string;
}) {
	const { t } = useTranslate();
	const [message, setMessage] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const form = useForm({
		defaultValues: { password: "", code: "", backupCode: "" },
	});
	const run = async (work: () => Promise<void>) => {
		setPending(true);
		setMessage(null);
		try {
			await work();
		} catch (error) {
			setMessage(
				error instanceof Error
					? error.message
					: t("mfa.verification.failed", "Verification failed"),
			);
		}
		setPending(false);
	};
	const continueToOrganization = () => {
		const query = new URLSearchParams();
		if (organizationId) query.set("organizationId", organizationId);
		if (callbackUrl) query.set("callbackUrl", callbackUrl);
		window.location.href = `/init?${query}`;
	};
	const verifyPassword = () =>
		run(async () => {
			const response = await fetch(
				"/api/auth/organization-mfa/verify-password",
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ password: form.getFieldValue("password") }),
				},
			);
			if (!response.ok)
				throw new Error(
					t("mfa.password.failed", "Password verification failed"),
				);
			form.setFieldValue("password", "");
			setMessage(
				t(
					"mfa.password.verified",
					"Password verified. You can enroll your first authenticator, or verify an existing authenticator or backup code below.",
				),
			);
		});
	return (
		<section className="space-y-5" aria-labelledby="mfa-verify-title">
			<h2 id="mfa-verify-title" className="text-lg font-medium">
				{t("mfa.verify.title", "Verify your sign-in")}
			</h2>
			<p>
				{t(
					"mfa.verify.description",
					"Verify an authenticator to return to your organization. Enrollment and remembered-device trust alone do not satisfy the requirement.",
				)}
			</p>
			{hasPassword && (
				<div className="space-y-2">
					<form.Field name="password">
						{(field) => (
							<>
								<Label htmlFor="mfa-password">
									{t("mfa.password.label", "Current password")}
								</Label>
								<Input
									id="mfa-password"
									name="password"
									type="password"
									autoComplete="current-password"
									value={field.state.value}
									onChange={(event) => field.handleChange(event.target.value)}
								/>
							</>
						)}
					</form.Field>
					<Button disabled={pending} onClick={verifyPassword}>
						{t("mfa.password.verify", "Verify password")}
					</Button>
				</div>
			)}
			<div className="space-y-2">
				<form.Field name="code">
					{(field) => (
						<>
							<Label htmlFor="mfa-code">
								{t("mfa.code.label", "Authenticator code")}
							</Label>
							<Input
								id="mfa-code"
								name="code"
								spellCheck={false}
								inputMode="numeric"
								autoComplete="one-time-code"
								value={field.state.value}
								onChange={(event) => field.handleChange(event.target.value)}
							/>
						</>
					)}
				</form.Field>
				<Button
					disabled={pending}
					onClick={() =>
						run(async () => {
							const result = await authClient.twoFactor.verifyTotp({
								code: form.getFieldValue("code"),
								trustDevice: false,
							});
							if (result.error) throw new Error(result.error.message);
							continueToOrganization();
						})
					}
				>
					{t("mfa.code.verify", "Verify authenticator")}
				</Button>
			</div>
			<Button
				variant="outline"
				disabled={pending}
				onClick={() =>
					run(async () => {
						const result = await authClient.signIn.passkey();
						if (result.error) throw new Error(result.error.message);
						continueToOrganization();
					})
				}
			>
				{t("mfa.passkey.verify", "Verify with a passkey")}
			</Button>
			{socialProviders.map((provider) => (
				<Button
					key={provider}
					variant="outline"
					disabled={pending}
					onClick={() =>
						run(async () => {
							const result = await authClient.signIn.social({
								provider,
								callbackURL: window.location.href,
							});
							if (result.error) throw new Error(result.error.message);
						})
					}
				>
					{t("mfa.social.verify", "Verify existing sign-in with {provider}", {
						provider,
					})}
				</Button>
			))}
			{organizationId && (
				<Button
					variant="outline"
					disabled={pending}
					onClick={() =>
						run(async () => {
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
									t("mfa.sso.failed", "Organization SSO could not be started"),
								);
							window.location.href = result.url;
						})
					}
				>
					{t("mfa.sso.verify", "Verify with organization SSO")}
				</Button>
			)}
			{hasPassword && (
				<div className="space-y-2 border-t pt-4">
					<p>
						{t(
							"mfa.recovery.description",
							"For recovery, verify your password above and then enter one unused backup code. This clears prior local verification across your organizations.",
						)}
					</p>
					<form.Field name="backupCode">
						{(field) => (
							<>
								<Label htmlFor="mfa-backup">
									{t("mfa.recovery.label", "Backup code")}
								</Label>
								<Input
									id="mfa-backup"
									name="backupCode"
									spellCheck={false}
									autoComplete="off"
									value={field.state.value}
									onChange={(event) => field.handleChange(event.target.value)}
								/>
							</>
						)}
					</form.Field>
					<Button
						variant="outline"
						disabled={pending}
						onClick={() =>
							run(async () => {
								const result = await authClient.twoFactor.verifyBackupCode({
									code: form.getFieldValue("backupCode"),
								});
								if (result.error) throw new Error(result.error.message);
								form.setFieldValue("backupCode", "");
								setMessage(
									t(
										"mfa.recovery.success",
										"Recovery permits replacement enrollment only. Verify an authenticator before returning to your organization.",
									),
								);
							})
						}
					>
						{t("mfa.recovery.action", "Recover with backup code")}
					</Button>
				</div>
			)}
			{message && (
				<p role="status" aria-live="polite">
					{message}
				</p>
			)}
			<Button
				variant="outline"
				disabled={pending}
				onClick={continueToOrganization}
			>
				{t("mfa.continue", "Continue after verification")}
			</Button>
		</section>
	);
}
