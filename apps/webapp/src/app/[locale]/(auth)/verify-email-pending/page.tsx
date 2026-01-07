"use client";

import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { AuthFormWrapper } from "@/components/auth-form-wrapper";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { Link } from "@/navigation";

export default function VerifyEmailPendingPage() {
	const { t } = useTranslate();
	const [isResending, setIsResending] = useState(false);
	const [resendMessage, setResendMessage] = useState<string>("");

	const handleResendEmail = async () => {
		setIsResending(true);
		setResendMessage("");

		try {
			const result = await authClient.sendVerificationEmail({
				email: "", // The user's email should be stored in session
				callbackURL: "/verify-email",
			});

			if (result.error) {
				setResendMessage(
					result.error.message ||
						t("auth.resend-verification-failed", "Failed to resend verification email"),
				);
			} else {
				setResendMessage(
					t(
						"auth.verification-email-resent",
						"Verification email has been resent! Please check your inbox.",
					),
				);
			}
		} catch (err) {
			setResendMessage(
				err instanceof Error ? err.message : t("common.error-occurred", "An error occurred"),
			);
		} finally {
			setIsResending(false);
		}
	};

	return (
		<AuthFormWrapper title={t("auth.verify-email-title", "Verify Your Email Address")}>
			<div className="text-center">
				<div className="mb-4 text-6xl">📧</div>
				<p className="mb-6 text-muted-foreground">
					{t(
						"auth.verification-email-sent",
						"We've sent a verification link to your email address. Please check your inbox and click the link to verify your account.",
					)}
				</p>

				<div className="mb-6 rounded-lg bg-muted p-4 text-sm">
					<p className="font-medium">{t("auth.check-console", "Development Mode:")}</p>
					<p className="text-muted-foreground">
						{t(
							"auth.check-console-message",
							"Since no email provider is configured, check your server console for the verification link.",
						)}
					</p>
				</div>

				<div className="space-y-4">
					{resendMessage && (
						<div
							className={`rounded-md p-3 text-sm ${
								resendMessage.includes("resent")
									? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400"
									: "bg-destructive/15 text-destructive"
							}`}
						>
							{resendMessage}
						</div>
					)}

					<div className="space-y-2">
						<p className="text-sm text-muted-foreground">
							{t("auth.didnt-receive-email", "Didn't receive the email?")}
						</p>
						<Button
							variant="outline"
							className="w-full"
							onClick={handleResendEmail}
							disabled={isResending}
						>
							{isResending
								? t("common.loading", "Loading...")
								: t("auth.resend-verification", "Resend Verification Email")}
						</Button>
					</div>

					<div className="pt-4">
						<Link href="/sign-in">
							<Button variant="link" className="w-full">
								{t("auth.back-to-signin", "Back to Sign In")}
							</Button>
						</Link>
					</div>
				</div>
			</div>
		</AuthFormWrapper>
	);
}
