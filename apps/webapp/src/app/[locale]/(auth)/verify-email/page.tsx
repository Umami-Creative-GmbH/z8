"use client";

import { useTranslate } from "@tolgee/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { Link } from "@/navigation";

export default function VerifyEmailPage() {
	const { t } = useTranslate();
	const router = useRouter();
	const searchParams = useSearchParams();
	const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
	const [errorMessage, setErrorMessage] = useState<string>("");

	useEffect(() => {
		const verifyEmail = async () => {
			const token = searchParams.get("token");

			if (!token) {
				setStatus("error");
				setErrorMessage(t("auth.missing-verification-token", "Missing verification token"));
				return;
			}

			try {
				const result = await authClient.verifyEmail({
					query: {
						token,
					},
				});

				if (result.error) {
					setStatus("error");
					setErrorMessage(
						result.error.message || t("auth.verification-failed-error", "Verification failed"),
					);
				} else {
					setStatus("success");
					setTimeout(() => {
						router.push("/sign-in");
					}, 3000);
				}
			} catch (err) {
				setStatus("error");
				setErrorMessage(
					err instanceof Error ? err.message : t("common.error-occurred", "An error occurred"),
				);
			}
		};

		verifyEmail();
	}, [searchParams, router, t]);

	return (
		<div className="flex min-h-screen items-center justify-center">
			<div className="w-full max-w-md space-y-6 rounded-lg border bg-card p-8 text-card-foreground shadow-sm">
				{status === "loading" && (
					<div className="text-center">
						<div className="mb-4 text-4xl">⏳</div>
						<h1 className="mb-2 text-2xl font-semibold">
							{t("auth.verifying-email", "Verifying your email...")}
						</h1>
						<p className="text-muted-foreground">
							{t("auth.please-wait", "Please wait while we verify your email address.")}
						</p>
					</div>
				)}

				{status === "success" && (
					<div className="text-center">
						<div className="mb-4 text-4xl">✅</div>
						<h1 className="mb-2 text-2xl font-semibold">
							{t("auth.email-verified", "Email Verified!")}
						</h1>
						<p className="mb-6 text-muted-foreground">
							{t(
								"auth.email-verified-message",
								"Your email has been successfully verified. You can now sign in to your account.",
							)}
						</p>
						<p className="text-sm text-muted-foreground">
							{t("auth.redirecting-to-signin", "Redirecting to sign in page in 3 seconds...")}
						</p>
						<Button className="mt-4" onClick={() => router.push("/sign-in")}>
							{t("auth.sign-in-now", "Sign in now")}
						</Button>
					</div>
				)}

				{status === "error" && (
					<div className="text-center">
						<div className="mb-4 text-4xl">❌</div>
						<h1 className="mb-2 text-2xl font-semibold">
							{t("auth.verification-failed", "Verification Failed")}
						</h1>
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
			</div>
		</div>
	);
}
