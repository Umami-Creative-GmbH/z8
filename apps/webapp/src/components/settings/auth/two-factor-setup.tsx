"use client";

import { useTranslate } from "@tolgee/react";
import dynamic from "next/dynamic";
import {
	BackupCodesActionPanel,
	DisableTwoFactorDialog,
	PasswordPromptPanel,
	SetupActionPanel,
} from "@/components/settings/auth/two-factor-panels";
import { useTwoFactorSetupController } from "@/components/settings/auth/use-two-factor-setup-controller";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

// Dynamic import QRCode (~30KB) - only loaded when 2FA setup dialog opens
const QRCodeSVG = dynamic(
	() => import("qrcode.react").then((mod) => mod.QRCodeSVG),
	{
		loading: () => <Skeleton className="size-[200px]" />,
		ssr: false,
	},
);

interface TwoFactorSetupProps {
	isEnabled: boolean;
	userEmail: string;
}

export function TwoFactorSetup({
	isEnabled: initialIsEnabled,
}: TwoFactorSetupProps) {
	const { t } = useTranslate();
	const { isPending, state, actions, handlers } = useTwoFactorSetupController(
		initialIsEnabled,
		t,
	);

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div>
					<h3 className="text-lg font-medium">
						{t(
							"settings.security.twoFactor.title",
							"Two-Factor Authentication",
						)}
					</h3>
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.security.twoFactor.description",
							"Add an extra layer of security to your account",
						)}
					</p>
				</div>
				<Badge variant={state.isEnabled ? "default" : "secondary"}>
					{state.isEnabled
						? t("settings.security.twoFactor.status.enabled", "Enabled")
						: t("settings.security.twoFactor.status.disabled", "Disabled")}
				</Badge>
			</div>

			<div className="flex gap-2">
				{!state.isEnabled ? (
					<Button onClick={handlers.handleRequestEnable} disabled={isPending}>
						{t(
							"settings.security.twoFactor.enable",
							"Enable Two-Factor Authentication",
						)}
					</Button>
				) : (
					<>
						<Button
							variant="outline"
							onClick={handlers.handleRequestRegenerate}
							disabled={isPending}
						>
							{t(
								"settings.security.twoFactor.regenerateBackupCodes",
								"Regenerate Backup Codes",
							)}
						</Button>
						<Button
							variant="destructive"
							onClick={() => actions.setDisableDialogOpen(true)}
							disabled={isPending}
						>
							{t("settings.security.twoFactor.disable", "Disable")}
						</Button>
					</>
				)}
			</div>

			<PasswordPromptPanel
				open={state.showPasswordDialog}
				onOpenChange={actions.setShowPasswordDialog}
				title={t(
					"settings.security.twoFactor.enterPasswordTitle",
					"Enter Your Password",
				)}
				description={t(
					"settings.security.twoFactor.confirmPasswordToEnable",
					"Please confirm your password to enable two-factor authentication",
				)}
				inputId="enable-2fa-password"
				password={state.password}
				onPasswordChange={actions.setPassword}
				onCancel={() => {
					actions.setShowPasswordDialog(false);
					actions.setPassword("");
				}}
				onConfirm={handlers.handleEnable2FA}
				confirmLabel={t("settings.security.twoFactor.continue", "Continue")}
				isPending={isPending}
				t={t}
			/>

			<PasswordPromptPanel
				open={state.showRegenerateDialog}
				onOpenChange={actions.setShowRegenerateDialog}
				title={t(
					"settings.security.twoFactor.enterPasswordTitle",
					"Enter Your Password",
				)}
				description={t(
					"settings.security.twoFactor.confirmPasswordToRegenerate",
					"Please confirm your password to regenerate backup codes",
				)}
				inputId="regenerate-2fa-password"
				password={state.regeneratePassword}
				onPasswordChange={actions.setRegeneratePassword}
				onCancel={() => {
					actions.setShowRegenerateDialog(false);
					actions.setRegeneratePassword("");
				}}
				onConfirm={handlers.handleRegenerateBackupCodes}
				confirmLabel={t(
					"settings.security.twoFactor.regenerateCodes",
					"Regenerate Codes",
				)}
				isPending={isPending}
				t={t}
			/>

			<SetupActionPanel
				open={state.setupDialogOpen}
				onOpenChange={actions.setSetupDialogOpen}
				totpUri={state.totpUri}
				otpValue={state.otpValue}
				onOtpValueChange={actions.setOtpValue}
				onCancel={() => actions.setSetupDialogOpen(false)}
				onVerify={handlers.handleVerifyAndEnable}
				isPending={isPending}
				t={t}
				QRCodeSVG={QRCodeSVG}
			/>

			<BackupCodesActionPanel
				open={state.backupCodesDialogOpen}
				onOpenChange={actions.setBackupCodesDialogOpen}
				backupCodes={state.backupCodes}
				onCopyCodes={handlers.handleCopyBackupCodes}
				onConfirmSaved={() => actions.setBackupCodesDialogOpen(false)}
				t={t}
			/>

			<DisableTwoFactorDialog
				open={state.disableDialogOpen}
				onOpenChange={actions.setDisableDialogOpen}
				disablePassword={state.disablePassword}
				onDisablePasswordChange={actions.setDisablePassword}
				onCancel={() => {
					actions.setDisableDialogOpen(false);
					actions.setDisablePassword("");
				}}
				onConfirm={handlers.handleDisable2FA}
				isPending={isPending}
				t={t}
			/>
		</div>
	);
}
