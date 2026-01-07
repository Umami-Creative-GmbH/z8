"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	InputOTP,
	InputOTPGroup,
	InputOTPSlot,
} from "@/components/ui/input-otp";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { twoFactor } from "@/lib/auth-client";

export function TwoFactorVerificationForm() {
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
					toast.error("Invalid backup code", {
						description: "Please enter a valid backup code",
					});
					setIsLoading(false);
					return;
				}

				const result = await twoFactor.verifyBackupCode({
					code: backupCode,
				});

				if (result.error) {
					toast.error("Verification failed", {
						description: result.error.message || "Invalid backup code",
					});
				} else {
					toast.success("Verification successful");
					router.push("/");
				}
			} else {
				if (otpValue.length !== 6) {
					toast.error("Invalid code", {
						description: "Please enter a 6-digit code",
					});
					setIsLoading(false);
					return;
				}

				const result = await twoFactor.verifyTotp({
					code: otpValue,
				});

				if (result.error) {
					toast.error("Verification failed", {
						description: result.error.message || "Invalid verification code",
					});
				} else {
					toast.success("Verification successful");
					router.push("/");
				}
			}
		} catch (error) {
			toast.error("Verification failed", {
				description:
					error instanceof Error
						? error.message
						: "An unexpected error occurred",
			});
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<Card className="w-full max-w-md">
			<CardHeader>
				<CardTitle>Two-Factor Authentication</CardTitle>
				<CardDescription>
					{useBackupCode
						? "Enter one of your backup codes"
						: "Enter the code from your authenticator app"}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{useBackupCode ? (
					<div className="space-y-2">
						<Label htmlFor="backup-code">Backup Code</Label>
						<Input
							id="backup-code"
							type="text"
							placeholder="Enter backup code"
							value={backupCode}
							onChange={(e) => setBackupCode(e.target.value)}
							disabled={isLoading}
							maxLength={10}
						/>
					</div>
				) : (
					<div className="space-y-2">
						<Label>Authentication Code</Label>
						<div className="flex justify-center">
							<InputOTP
								maxLength={6}
								value={otpValue}
								onChange={setOtpValue}
								disabled={isLoading}
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
					{isLoading ? "Verifying..." : "Verify"}
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
						? "Use authenticator app instead"
						: "Use backup code instead"}
				</Button>
			</CardContent>
		</Card>
	);
}
