"use client";

import { useTranslate } from "@tolgee/react";
import dynamic from "next/dynamic";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

// Dynamic import QRCode (~30KB) - only loaded when 2FA setup dialog opens
const QRCodeSVG = dynamic(() => import("qrcode.react").then((mod) => mod.QRCodeSVG), {
	loading: () => <Skeleton className="h-[200px] w-[200px]" />,
	ssr: false,
});

import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { getAuthErrorMessage } from "@/lib/auth/error-message";
import { authClient } from "@/lib/auth-client";

interface TwoFactorSetupProps {
	isEnabled: boolean;
	userEmail: string;
}

export function TwoFactorSetup({ isEnabled: initialIsEnabled }: TwoFactorSetupProps) {
	const { t } = useTranslate();
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
			toast.error(t("settings.security.twoFactor.passwordRequired", "Password required"), {
				description: t(
					"settings.security.twoFactor.enablePasswordRequiredDescription",
					"Please enter your password to enable 2FA",
				),
			});
			return;
		}

		startTransition(async () => {
			try {
				const result = await authClient.twoFactor.enable({
					password,
				});

				if (result.error) {
					toast.error(t("settings.security.twoFactor.setupFailed", "Failed to setup 2FA"), {
						description: getAuthErrorMessage(
							result.error,
							t("settings.security.twoFactor.setupFailed", "Failed to setup 2FA"),
						),
					});
				} else if (result.data) {
					setTotpUri(result.data.totpURI);
					setBackupCodes(result.data.backupCodes);
					setShowPasswordDialog(false);
					setSetupDialogOpen(true);
					setPassword("");
				}
			} catch (error) {
				toast.error(t("settings.security.twoFactor.setupFailed", "Failed to setup 2FA"), {
					description:
						error instanceof Error
							? error.message
							: t("settings.security.twoFactor.unexpectedError", "An unexpected error occurred"),
				});
			}
		});
	};

	const handleVerifyAndEnable = () => {
		if (otpValue.length !== 6) {
			toast.error(t("settings.security.twoFactor.invalidCode", "Invalid code"), {
				description: t(
					"settings.security.twoFactor.enterSixDigitCode",
					"Please enter a 6-digit code",
				),
			});
			return;
		}

		startTransition(async () => {
			try {
				const result = await authClient.twoFactor.verifyTotp({
					code: otpValue,
				});

				if (result.error) {
					toast.error(t("settings.security.twoFactor.verificationFailed", "Verification failed"), {
						description: getAuthErrorMessage(
							result.error,
							t("settings.security.twoFactor.verificationFailed", "Verification failed"),
						),
					});
				} else {
					setSetupDialogOpen(false);
					setBackupCodesDialogOpen(true);
					setOtpValue("");
					setIsEnabled(true);
					toast.success(
						t("settings.security.twoFactor.enabledToast", "Two-factor authentication enabled"),
					);
				}
			} catch (error) {
				toast.error(t("settings.security.twoFactor.verificationFailed", "Verification failed"), {
					description:
						error instanceof Error
							? error.message
							: t("settings.security.twoFactor.unexpectedError", "An unexpected error occurred"),
				});
			}
		});
	};

	const [disablePassword, setDisablePassword] = useState("");

	const handleDisable2FA = () => {
		if (!disablePassword) {
			toast.error(t("settings.security.twoFactor.passwordRequired", "Password required"));
			return;
		}

		startTransition(async () => {
			try {
				const result = await authClient.twoFactor.disable({
					password: disablePassword,
				});

				if (result.error) {
					toast.error(t("settings.security.twoFactor.disableFailed", "Failed to disable 2FA"), {
						description: getAuthErrorMessage(
							result.error,
							t("settings.security.twoFactor.disableFailed", "Failed to disable 2FA"),
						),
					});
				} else {
					setDisableDialogOpen(false);
					setDisablePassword("");
					setIsEnabled(false);
					toast.success(
						t("settings.security.twoFactor.disabledToast", "Two-factor authentication disabled"),
					);
				}
			} catch (error) {
				toast.error(t("settings.security.twoFactor.disableFailed", "Failed to disable 2FA"), {
					description:
						error instanceof Error
							? error.message
							: t("settings.security.twoFactor.unexpectedError", "An unexpected error occurred"),
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
			toast.error(t("settings.security.twoFactor.passwordRequired", "Password required"));
			return;
		}

		startTransition(async () => {
			try {
				const result = await authClient.twoFactor.generateBackupCodes({
					password: regeneratePassword,
				});

				if (result.error) {
					toast.error(
						t("settings.security.twoFactor.regenerateFailed", "Failed to regenerate backup codes"),
						{
							description: getAuthErrorMessage(
								result.error,
								t(
									"settings.security.twoFactor.regenerateFailed",
									"Failed to regenerate backup codes",
								),
							),
						},
					);
				} else if (result.data) {
					setBackupCodes(result.data.backupCodes);
					setShowRegenerateDialog(false);
					setBackupCodesDialogOpen(true);
					setRegeneratePassword("");
					toast.success(
						t("settings.security.twoFactor.backupCodesRegenerated", "Backup codes regenerated"),
					);
				}
			} catch (error) {
				toast.error(
					t("settings.security.twoFactor.regenerateFailed", "Failed to regenerate backup codes"),
					{
						description:
							error instanceof Error
								? error.message
								: t("settings.security.twoFactor.unexpectedError", "An unexpected error occurred"),
					},
				);
			}
		});
	};

	const handleCopyBackupCodes = () => {
		navigator.clipboard.writeText(backupCodes.join("\n"));
		toast.success(
			t("settings.security.twoFactor.backupCodesCopied", "Backup codes copied to clipboard"),
		);
	};

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div>
					<h3 className="text-lg font-medium">
						{t("settings.security.twoFactor.title", "Two-Factor Authentication")}
					</h3>
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.security.twoFactor.description",
							"Add an extra layer of security to your account",
						)}
					</p>
				</div>
				<Badge variant={isEnabled ? "default" : "secondary"}>
					{isEnabled
						? t("settings.security.twoFactor.status.enabled", "Enabled")
						: t("settings.security.twoFactor.status.disabled", "Disabled")}
				</Badge>
			</div>

			<div className="flex gap-2">
				{!isEnabled ? (
					<Button onClick={handleRequestEnable} disabled={isPending}>
						{t("settings.security.twoFactor.enable", "Enable Two-Factor Authentication")}
					</Button>
				) : (
					<>
						<Button variant="outline" onClick={handleRequestRegenerate} disabled={isPending}>
							{t("settings.security.twoFactor.regenerateBackupCodes", "Regenerate Backup Codes")}
						</Button>
						<Button
							variant="destructive"
							onClick={() => setDisableDialogOpen(true)}
							disabled={isPending}
						>
							{t("settings.security.twoFactor.disable", "Disable")}
						</Button>
					</>
				)}
			</div>

			{/* Password Input ActionPanel for Enabling 2FA */}
			<ActionPanel open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
				<ActionPanelContent>
					<ActionPanelHeader>
						<ActionPanelTitle>
							{t("settings.security.twoFactor.enterPasswordTitle", "Enter Your Password")}
						</ActionPanelTitle>
						<ActionPanelDescription>
							{t(
								"settings.security.twoFactor.confirmPasswordToEnable",
								"Please confirm your password to enable two-factor authentication",
							)}
						</ActionPanelDescription>
					</ActionPanelHeader>
					<ActionPanelBody className="space-y-4">
						<div className="space-y-2">
							<label className="text-sm font-medium" htmlFor="enable-2fa-password">
								{t("settings.security.twoFactor.passwordLabel", "Password")}
							</label>
							<input
								id="enable-2fa-password"
								name="password"
								type="password"
								autoComplete="current-password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
								placeholder={t(
									"settings.security.twoFactor.passwordPlaceholder",
									"Enter your password…",
								)}
							/>
						</div>
					</ActionPanelBody>
					<ActionPanelFooter>
						<Button
							variant="outline"
							onClick={() => {
								setShowPasswordDialog(false);
								setPassword("");
							}}
							disabled={isPending}
						>
							{t("settings.security.twoFactor.cancel", "Cancel")}
						</Button>
						<Button onClick={handleEnable2FA} disabled={isPending || !password}>
							{t("settings.security.twoFactor.continue", "Continue")}
						</Button>
					</ActionPanelFooter>
				</ActionPanelContent>
			</ActionPanel>

			{/* Password Input ActionPanel for Regenerating Backup Codes */}
			<ActionPanel open={showRegenerateDialog} onOpenChange={setShowRegenerateDialog}>
				<ActionPanelContent>
					<ActionPanelHeader>
						<ActionPanelTitle>
							{t("settings.security.twoFactor.enterPasswordTitle", "Enter Your Password")}
						</ActionPanelTitle>
						<ActionPanelDescription>
							{t(
								"settings.security.twoFactor.confirmPasswordToRegenerate",
								"Please confirm your password to regenerate backup codes",
							)}
						</ActionPanelDescription>
					</ActionPanelHeader>
					<ActionPanelBody className="space-y-4">
						<div className="space-y-2">
							<label className="text-sm font-medium" htmlFor="regenerate-2fa-password">
								{t("settings.security.twoFactor.passwordLabel", "Password")}
							</label>
							<input
								id="regenerate-2fa-password"
								name="password"
								type="password"
								autoComplete="current-password"
								value={regeneratePassword}
								onChange={(e) => setRegeneratePassword(e.target.value)}
								className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
								placeholder={t(
									"settings.security.twoFactor.passwordPlaceholder",
									"Enter your password…",
								)}
							/>
						</div>
					</ActionPanelBody>
					<ActionPanelFooter>
						<Button
							variant="outline"
							onClick={() => {
								setShowRegenerateDialog(false);
								setRegeneratePassword("");
							}}
							disabled={isPending}
						>
							{t("settings.security.twoFactor.cancel", "Cancel")}
						</Button>
						<Button
							onClick={handleRegenerateBackupCodes}
							disabled={isPending || !regeneratePassword}
						>
							{t("settings.security.twoFactor.regenerateCodes", "Regenerate Codes")}
						</Button>
					</ActionPanelFooter>
				</ActionPanelContent>
			</ActionPanel>

			{/* Setup ActionPanel */}
			<ActionPanel open={setupDialogOpen} onOpenChange={setSetupDialogOpen}>
				<ActionPanelContent>
					<ActionPanelHeader>
						<ActionPanelTitle>
							{t("settings.security.twoFactor.setupTitle", "Setup Two-Factor Authentication")}
						</ActionPanelTitle>
						<ActionPanelDescription>
							{t(
								"settings.security.twoFactor.scanQrCode",
								"Scan the QR code with your authenticator app",
							)}
						</ActionPanelDescription>
					</ActionPanelHeader>

					<ActionPanelBody className="space-y-4">
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
							<div className="text-sm font-medium">
								{t(
									"settings.security.twoFactor.enterAuthenticatorCode",
									"Enter the 6-digit code from your authenticator app",
								)}
							</div>
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
					</ActionPanelBody>

					<ActionPanelFooter>
						<Button
							variant="outline"
							onClick={() => setSetupDialogOpen(false)}
							disabled={isPending}
						>
							{t("settings.security.twoFactor.cancel", "Cancel")}
						</Button>
						<Button onClick={handleVerifyAndEnable} disabled={isPending || otpValue.length !== 6}>
							{t("settings.security.twoFactor.verifyAndEnable", "Verify and Enable")}
						</Button>
					</ActionPanelFooter>
				</ActionPanelContent>
			</ActionPanel>

			{/* Backup Codes ActionPanel */}
			<ActionPanel open={backupCodesDialogOpen} onOpenChange={setBackupCodesDialogOpen}>
				<ActionPanelContent>
					<ActionPanelHeader>
						<ActionPanelTitle>
							{t("settings.security.twoFactor.saveBackupCodesTitle", "Save Your Backup Codes")}
						</ActionPanelTitle>
						<ActionPanelDescription>
							{t(
								"settings.security.twoFactor.saveBackupCodesDescription",
								"Keep these codes in a safe place. You can use them to access your account if you lose access to your authenticator app. Each code can only be used once.",
							)}
						</ActionPanelDescription>
					</ActionPanelHeader>

					<ActionPanelBody className="space-y-4">
						<div className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-4">
							{backupCodes.map((code) => (
								<code key={code} className="text-sm font-mono">
									{code}
								</code>
							))}
						</div>

						<Button variant="outline" onClick={handleCopyBackupCodes} className="w-full">
							{t("settings.security.twoFactor.copyCodes", "Copy Codes")}
						</Button>
					</ActionPanelBody>

					<ActionPanelFooter>
						<Button onClick={() => setBackupCodesDialogOpen(false)}>
							{t("settings.security.twoFactor.savedCodes", "I've Saved These Codes")}
						</Button>
					</ActionPanelFooter>
				</ActionPanelContent>
			</ActionPanel>

			{/* Disable confirmation */}
			<AlertDialog open={disableDialogOpen} onOpenChange={setDisableDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("settings.security.twoFactor.disableTitle", "Disable Two-Factor Authentication?")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.security.twoFactor.disableDescription",
								"This will remove the extra layer of security from your account. Please enter your password to confirm.",
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<div className="space-y-4">
						<div className="space-y-2">
							<label className="text-sm font-medium" htmlFor="disable-2fa-password">
								{t("settings.security.twoFactor.passwordLabel", "Password")}
							</label>
							<input
								id="disable-2fa-password"
								name="password"
								type="password"
								autoComplete="current-password"
								value={disablePassword}
								onChange={(e) => setDisablePassword(e.target.value)}
								className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
								placeholder={t(
									"settings.security.twoFactor.passwordPlaceholder",
									"Enter your password…",
								)}
							/>
						</div>
					</div>
					<AlertDialogFooter>
						<AlertDialogCancel
							onClick={() => {
								setDisableDialogOpen(false);
								setDisablePassword("");
							}}
							disabled={isPending}
						>
							{t("settings.security.twoFactor.cancel", "Cancel")}
						</AlertDialogCancel>
						<AlertDialogAction asChild>
							<Button
								variant="destructive"
								onClick={(event) => {
									event.preventDefault();
									handleDisable2FA();
								}}
								disabled={isPending || !disablePassword}
							>
								{t("settings.security.twoFactor.disable2fa", "Disable 2FA")}
							</Button>
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
