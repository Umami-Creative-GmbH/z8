"use client";

import { useTranslate } from "@tolgee/react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthFormWrapper } from "@/components/auth-form-wrapper";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { Link, useRouter } from "@/navigation";
import { processPendingInviteCode } from "@/app/[locale]/(app)/settings/organizations/invite-code-actions";

type JoinResult = {
	success: boolean;
	status: "pending" | "approved";
	organizationName: string;
} | null;

export default function VerifyEmailPage() {
	const { t } = useTranslate();
	const router = useRouter();
	const searchParams = useSearchParams();
	const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
	const [errorMessage, setErrorMessage] = useState<string>("");
	const [joinResult, setJoinResult] = useState<JoinResult>(null);

	useEffect(() => {
		const verifyEmail = async () => {
			const token = searchParams.get("token");

			if (!token) {
				setStatus("error");
				setErrorMessage(t("auth.missing-verification-token", "Missing verification token"));
				return;
			}

			const result = await authClient
				.verifyEmail({
					query: {
						token,
					},
				})
				.catch((error) => ({
					error: {
						message:
							error instanceof Error
								? error.message
								: t("common.error-occurred", "An error occurred"),
					},
				}));

			if (result.error) {
				setStatus("error");
				setErrorMessage(
					result.error.message || t("auth.verification-failed-error", "Verification failed"),
				);
				return;
			}

			// Process any pending invite code after successful verification
			let pendingJoinResult: JoinResult = null;
			const pendingResult = await processPendingInviteCode().catch(() => null);
			if (pendingResult?.success && pendingResult.data) {
				pendingJoinResult = pendingResult.data;
				setJoinResult(pendingJoinResult);
			}

			setStatus("success");
			setTimeout(() => {
				// If user joined an organization, go to onboarding
				// Otherwise, go to sign-in
				if (pendingJoinResult) {
					router.push("/onboarding");
				} else {
					router.push("/sign-in");
				}
			}, 3000);
		};

		verifyEmail();
	}, [searchParams, router, t]);

	const getTitle = () => {
		if (status === "loading") return t("auth.verifying-email", "Verifying your email...");
		if (status === "success") return t("auth.email-verified", "Email Verified!");
		return t("auth.verification-failed", "Verification Failed");
	};

	return (
		<AuthFormWrapper title={getTitle()}>
			{status === "loading" && (
				<div className="text-center">
					<div className="mb-4 text-4xl">⏳</div>
					<p className="text-muted-foreground">
						{t("auth.please-wait", "Please wait while we verify your email address.")}
					</p>
				</div>
			)}

			{status === "success" && (
				<div className="text-center">
					<div className="mb-4 text-4xl">✅</div>
					<p className="mb-6 text-muted-foreground">
						{t(
							"auth.email-verified-message",
							"Your email has been successfully verified. You can now sign in to your account.",
						)}
					</p>
					{joinResult && (
						<div className="mb-4 rounded-lg border bg-muted/50 p-4">
							<p className="font-medium">
								{joinResult.status === "approved"
									? t("auth.joined-organization", "You've joined {organization}!", {
											organization: joinResult.organizationName,
										})
									: t(
											"auth.pending-organization-approval",
											"Your request to join {organization} is pending approval.",
											{ organization: joinResult.organizationName },
										)}
							</p>
						</div>
					)}
					<p className="text-sm text-muted-foreground">
						{joinResult
							? t("auth.redirecting-to-onboarding", "Redirecting to complete setup...")
							: t("auth.redirecting-to-signin", "Redirecting to sign in page in 3 seconds...")}
					</p>
					<Button
						className="mt-4 w-full"
						onClick={() => router.push(joinResult ? "/onboarding" : "/sign-in")}
					>
						{joinResult
							? t("auth.continue-setup", "Continue Setup")
							: t("auth.sign-in-now", "Sign in now")}
					</Button>
				</div>
			)}

			{status === "error" && (
				<div className="text-center">
					<div className="mb-4 text-4xl">❌</div>
					<p className="mb-6 text-destructive">{errorMessage}</p>
					<div className="space-y-2">
						<Link href="/sign-up">
							<Button variant="outline" className="w-full">
								{t("auth.back-to-signup", "Back to Sign Up")}
							</Button>
						</Link>
						<Link href="/sign-in">
							<Button className="w-full">{t("auth.try-signin", "Try to Sign In")}</Button>
						</Link>
					</div>
				</div>
			)}
		</AuthFormWrapper>
	);
}
