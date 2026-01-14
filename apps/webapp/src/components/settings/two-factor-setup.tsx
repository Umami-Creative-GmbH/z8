"use client";

import { QRCodeSVG } from "qrcode.react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { authClient } from "@/lib/auth-client";

interface TwoFactorSetupProps {
	isEnabled: boolean;
	userEmail: string;
}

export function TwoFactorSetup({ isEnabled: initialIsEnabled, userEmail }: TwoFactorSetupProps) {
	const [isPending, startTransition] = useTransition();
	const [isEnabled, setIsEnabled] = useState(initialIsEnabled);
	const [setupDialogOpen, setSetupDialogOpen] = useState(false);
	const [backupCodesDialogOpen, setBackupCodesDialogOpen] = useState(false);
	const [disableDialogOpen, setDisableDialogOpen] = useState(false);

	const [totpUri, setTotpUri] = useState<string>("");
	const [backupCodes, setBackupCodes] = useState<string[]>([]);
	const [otpValue, setOtpValue] = useState("");
	const [password, setPassword] = useState("");
	const [showPasswordDialog, setShowPasswordDialog] = useState(false);

	const handleRequestEnable = () => {
		setShowPasswordDialog(true);
	};

	const handleEnable2FA = () => {
		if (!password) {
			toast.error("Password required", {
				description: "Please enter your password to enable 2FA",
			});
			return;
		}

		startTransition(async () => {
			try {
				const result = await authClient.twoFactor.enable({
					password,
				});

				if (result.error) {
					toast.error("Failed to setup 2FA", {
						description: result.error.message,
					});
				} else if (result.data) {
					setTotpUri(result.data.totpURI);
					setBackupCodes(result.data.backupCodes);
					setShowPasswordDialog(false);
					setSetupDialogOpen(true);
					setPassword("");
				}
			} catch (error) {
				toast.error("Failed to setup 2FA", {
					description: error instanceof Error ? error.message : "An unexpected error occurred",
				});
			}
		});
	};

	const handleVerifyAndEnable = () => {
		if (otpValue.length !== 6) {
			toast.error("Invalid code", {
				description: "Please enter a 6-digit code",
			});
			return;
		}

		startTransition(async () => {
			try {
				const result = await authClient.twoFactor.verifyTotp({
					code: otpValue,
				});

				if (result.error) {
					toast.error("Verification failed", {
						description: result.error.message,
					});
				} else {
					setSetupDialogOpen(false);
					setBackupCodesDialogOpen(true);
					setOtpValue("");
					setIsEnabled(true);
					toast.success("Two-factor authentication enabled");
				}
			} catch (error) {
				toast.error("Verification failed", {
					description: error instanceof Error ? error.message : "An unexpected error occurred",
				});
			}
		});
	};

	const [disablePassword, setDisablePassword] = useState("");

	const handleDisable2FA = () => {
		if (!disablePassword) {
			toast.error("Password required");
			return;
		}

		startTransition(async () => {
			try {
				const result = await authClient.twoFactor.disable({
					password: disablePassword,
				});

				if (result.error) {
					toast.error("Failed to disable 2FA", {
						description: result.error.message,
					});
				} else {
					setDisableDialogOpen(false);
					setDisablePassword("");
					setIsEnabled(false);
					toast.success("Two-factor authentication disabled");
				}
			} catch (error) {
				toast.error("Failed to disable 2FA", {
					description: error instanceof Error ? error.message : "An unexpected error occurred",
				});
			}
		});
	};

	const [regeneratePassword, setRegeneratePassword] = useState("");
	const [showRegenerateDialog, setShowRegenerateDialog] = useState(false);

	const handleRequestRegenerate = () => {
		setShowRegenerateDialog(true);
	};

	const handleRegenerateBackupCodes = () => {
		if (!regeneratePassword) {
			toast.error("Password required");
			return;
		}

		startTransition(async () => {
			try {
				const result = await authClient.twoFactor.generateBackupCodes({
					password: regeneratePassword,
				});

				if (result.error) {
					toast.error("Failed to regenerate backup codes", {
						description: result.error.message,
					});
				} else if (result.data) {
					setBackupCodes(result.data.backupCodes);
					setShowRegenerateDialog(false);
					setBackupCodesDialogOpen(true);
					setRegeneratePassword("");
					toast.success("Backup codes regenerated");
				}
			} catch (error) {
				toast.error("Failed to regenerate backup codes", {
					description: error instanceof Error ? error.message : "An unexpected error occurred",
				});
			}
		});
	};

	const handleCopyBackupCodes = () => {
		navigator.clipboard.writeText(backupCodes.join("\n"));
		toast.success("Backup codes copied to clipboard");
	};

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div>
					<h3 className="text-lg font-medium">Two-Factor Authentication</h3>
					<p className="text-sm text-muted-foreground">
						Add an extra layer of security to your account
					</p>
				</div>
				<Badge variant={isEnabled ? "default" : "secondary"}>
					{isEnabled ? "Enabled" : "Disabled"}
				</Badge>
			</div>

			<div className="flex gap-2">
				{!isEnabled ? (
					<Button onClick={handleRequestEnable} disabled={isPending}>
						Enable Two-Factor Authentication
					</Button>
				) : (
					<>
						<Button variant="outline" onClick={handleRequestRegenerate} disabled={isPending}>
							Regenerate Backup Codes
						</Button>
						<Button
							variant="destructive"
							onClick={() => setDisableDialogOpen(true)}
							disabled={isPending}
						>
							Disable
						</Button>
					</>
				)}
			</div>

			{/* Password Input Dialog for Enabling 2FA */}
			<Dialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Enter Your Password</DialogTitle>
						<DialogDescription>
							Please confirm your password to enable two-factor authentication
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4">
						<div className="space-y-2">
							<label className="text-sm font-medium">Password</label>
							<input
								type="password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
								placeholder="Enter your password"
							/>
						</div>
					</div>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => {
								setShowPasswordDialog(false);
								setPassword("");
							}}
							disabled={isPending}
						>
							Cancel
						</Button>
						<Button onClick={handleEnable2FA} disabled={isPending || !password}>
							Continue
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Password Input Dialog for Regenerating Backup Codes */}
			<Dialog open={showRegenerateDialog} onOpenChange={setShowRegenerateDialog}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Enter Your Password</DialogTitle>
						<DialogDescription>
							Please confirm your password to regenerate backup codes
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4">
						<div className="space-y-2">
							<label className="text-sm font-medium">Password</label>
							<input
								type="password"
								value={regeneratePassword}
								onChange={(e) => setRegeneratePassword(e.target.value)}
								className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
								placeholder="Enter your password"
							/>
						</div>
					</div>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => {
								setShowRegenerateDialog(false);
								setRegeneratePassword("");
							}}
							disabled={isPending}
						>
							Cancel
						</Button>
						<Button
							onClick={handleRegenerateBackupCodes}
							disabled={isPending || !regeneratePassword}
						>
							Regenerate Codes
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Setup Dialog */}
			<Dialog open={setupDialogOpen} onOpenChange={setSetupDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Setup Two-Factor Authentication</DialogTitle>
						<DialogDescription>Scan the QR code with your authenticator app</DialogDescription>
					</DialogHeader>

					<div className="space-y-4">
						{/* QR Code */}
						<div className="flex justify-center">
							{totpUri && (
								<div className="rounded-lg border p-4">
									<QRCodeSVG value={totpUri} size={200} />
								</div>
							)}
						</div>

						{/* OTP Input */}
						<div className="space-y-2">
							<label className="text-sm font-medium">
								Enter the 6-digit code from your authenticator app
							</label>
							<div className="flex justify-center">
								<InputOTP maxLength={6} value={otpValue} onChange={setOtpValue}>
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
					</div>

					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setSetupDialogOpen(false)}
							disabled={isPending}
						>
							Cancel
						</Button>
						<Button onClick={handleVerifyAndEnable} disabled={isPending || otpValue.length !== 6}>
							Verify and Enable
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Backup Codes Dialog */}
			<Dialog open={backupCodesDialogOpen} onOpenChange={setBackupCodesDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Save Your Backup Codes</DialogTitle>
						<DialogDescription>
							Keep these codes in a safe place. You can use them to access your account if you lose
							access to your authenticator app. Each code can only be used once.
						</DialogDescription>
					</DialogHeader>

					<div className="space-y-4">
						<div className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-4">
							{backupCodes.map((code, index) => (
								<code key={index} className="text-sm font-mono">
									{code}
								</code>
							))}
						</div>

						<Button variant="outline" onClick={handleCopyBackupCodes} className="w-full">
							Copy Codes
						</Button>
					</div>

					<DialogFooter>
						<Button onClick={() => setBackupCodesDialogOpen(false)}>I've Saved These Codes</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Disable Confirmation Dialog */}
			<Dialog open={disableDialogOpen} onOpenChange={setDisableDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Disable Two-Factor Authentication?</DialogTitle>
						<DialogDescription>
							This will remove the extra layer of security from your account. Please enter your
							password to confirm.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4">
						<div className="space-y-2">
							<label className="text-sm font-medium">Password</label>
							<input
								type="password"
								value={disablePassword}
								onChange={(e) => setDisablePassword(e.target.value)}
								className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
								placeholder="Enter your password"
							/>
						</div>
					</div>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => {
								setDisableDialogOpen(false);
								setDisablePassword("");
							}}
							disabled={isPending}
						>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={handleDisable2FA}
							disabled={isPending || !disablePassword}
						>
							Disable 2FA
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
