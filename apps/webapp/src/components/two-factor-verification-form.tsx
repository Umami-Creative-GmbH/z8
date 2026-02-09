"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "@/navigation";

export function TwoFactorVerificationForm() {
	const { t } = useTranslate();
	const router = useRouter();
	const [isLoading, setIsLoading] = useState(false);
	const [useBackupCode, setUseBackupCode] = useState(false);
	const [otpValue, setOtpValue] = useState("");
	const [backupCode, setBackupCode] = useState("");

	const handleVerify = async () => {
		setIsLoading(true);

		try {
			if (useBackupCode) {
				if (backupCode.length < 6) {
					toast.error(t("auth.2fa.invalid-backup-code", "Invalid backup code"), {
						description: t("auth.2fa.enter-valid-backup-code", "Please enter a valid backup code"),
					});
					setIsLoading(false);
					return;
				}

				const result = await authClient.twoFactor.verifyBackupCode({
					code: backupCode,
				});

				if (result.error) {
					toast.error(t("auth.2fa.verification-failed", "Verification failed"), {
						description:
							result.error.message || t("auth.2fa.invalid-backup-code", "Invalid backup code"),
					});
				} else {
					toast.success(t("auth.2fa.verification-successful", "Verification successful"));
					router.push("/");
				}
			} else {
				if (otpValue.length !== 6) {
					toast.error(t("auth.2fa.invalid-code", "Invalid code"), {
						description: t("auth.2fa.enter-6-digit-code", "Please enter a 6-digit code"),
					});
					setIsLoading(false);
					return;
				}

				const result = await authClient.twoFactor.verifyTotp({
					code: otpValue,
				});

				if (result.error) {
					toast.error(t("auth.2fa.verification-failed", "Verification failed"), {
						description:
							result.error.message ||
							t("auth.2fa.invalid-verification-code", "Invalid verification code"),
					});
				} else {
					toast.success(t("auth.2fa.verification-successful", "Verification successful"));
					router.push("/");
				}
			}
		} catch (error) {
			toast.error(t("auth.2fa.verification-failed", "Verification failed"), {
				description:
					error instanceof Error
						? error.message
						: t("auth.2fa.unexpected-error", "An unexpected error occurred"),
			});
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<Card className="w-full max-w-md">
			<CardHeader>
				<CardTitle>{t("auth.2fa.title", "Two-Factor Authentication")}</CardTitle>
				<CardDescription>
					{useBackupCode
						? t("auth.2fa.backup-code-prompt", "Enter one of your backup codes")
						: t("auth.2fa.authenticator-prompt", "Enter the code from your authenticator app")}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{useBackupCode ? (
					<div className="space-y-2">
						<Label htmlFor="backup-code">{t("auth.2fa.backup-code-label", "Backup Code")}</Label>
						<Input
							id="backup-code"
							type="text"
							autoComplete="one-time-code"
							placeholder={t("auth.2fa.backup-code-placeholder", "Enter backup code")}
							value={backupCode}
							onChange={(e) => setBackupCode(e.target.value)}
							disabled={isLoading}
							maxLength={10}
						/>
					</div>
				) : (
					<div className="space-y-2">
						<Label>{t("auth.2fa.code-label", "Authentication Code")}</Label>
						<div className="flex justify-center">
							<InputOTP
								maxLength={6}
								value={otpValue}
								onChange={setOtpValue}
								disabled={isLoading}
								autoComplete="one-time-code"
							>
								<InputOTPGroup>
									<InputOTPSlot index={0} />
									<InputOTPSlot index={1} />
									<InputOTPSlot index={2} />
									<InputOTPSlot index={3} />
									<InputOTPSlot index={4} />
									<InputOTPSlot index={5} />
								</InputOTPGroup>
							</InputOTP>
						</div>
					</div>
				)}

				<Button onClick={handleVerify} disabled={isLoading} className="w-full">
					{isLoading ? (
						<>
							<IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
							{t("auth.2fa.verifying", "Verifying...")}
						</>
					) : (
						t("auth.2fa.verify", "Verify")
					)}
				</Button>

				<Button
					variant="link"
					onClick={() => {
						setUseBackupCode(!useBackupCode);
						setOtpValue("");
						setBackupCode("");
					}}
					disabled={isLoading}
					className="w-full"
				>
					{useBackupCode
						? t("auth.2fa.use-authenticator", "Use authenticator app instead")
						: t("auth.2fa.use-backup", "Use backup code instead")}
				</Button>
			</CardContent>
		</Card>
	);
}
