import type { ComponentProps, ComponentType } from "react";
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
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

const TEXT_INPUT_CLASSNAME =
	"flex h-10 w-full rounded-md border border-input px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

type TranslateFn = (
	key: string,
	defaultValue?: string,
	params?: Record<string, string | number>,
) => string;

type QRCodeSVGProps = ComponentProps<typeof import("qrcode.react").QRCodeSVG>;

interface PasswordPromptPanelProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description: string;
	inputId: string;
	password: string;
	onPasswordChange: (value: string) => void;
	onCancel: () => void;
	onConfirm: () => void;
	confirmLabel: string;
	isPending: boolean;
	t: TranslateFn;
}

export function PasswordPromptPanel({
	open,
	onOpenChange,
	title,
	description,
	inputId,
	password,
	onPasswordChange,
	onCancel,
	onConfirm,
	confirmLabel,
	isPending,
	t,
}: PasswordPromptPanelProps) {
	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>{title}</ActionPanelTitle>
					<ActionPanelDescription>{description}</ActionPanelDescription>
				</ActionPanelHeader>
				<ActionPanelBody className="space-y-4">
					<div className="space-y-2">
						<label className="text-sm font-medium" htmlFor={inputId}>
							{t("settings.security.twoFactor.passwordLabel", "Password")}
						</label>
						<input
							id={inputId}
							name="password"
							type="password"
							aria-label={t("settings.security.twoFactor.passwordLabel", "Password")}
							autoComplete="current-password"
							value={password}
							onChange={(event) => onPasswordChange(event.target.value)}
							className={TEXT_INPUT_CLASSNAME}
							placeholder={t(
								"settings.security.twoFactor.passwordPlaceholder",
								"Enter your password...",
							)}
						/>
					</div>
				</ActionPanelBody>
				<ActionPanelFooter>
					<Button variant="outline" onClick={onCancel} disabled={isPending}>
						{t("settings.security.twoFactor.cancel", "Cancel")}
					</Button>
					<Button onClick={onConfirm} disabled={isPending || !password}>
						{confirmLabel}
					</Button>
				</ActionPanelFooter>
			</ActionPanelContent>
		</ActionPanel>
	);
}

interface SetupActionPanelProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	totpUri: string;
	otpValue: string;
	onOtpValueChange: (value: string) => void;
	onCancel: () => void;
	onVerify: () => void;
	isPending: boolean;
	t: TranslateFn;
	QRCodeSVG: ComponentType<QRCodeSVGProps>;
}

export function SetupActionPanel({
	open,
	onOpenChange,
	totpUri,
	otpValue,
	onOtpValueChange,
	onCancel,
	onVerify,
	isPending,
	t,
	QRCodeSVG,
}: SetupActionPanelProps) {
	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
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
					<div className="flex justify-center">
						{totpUri ? (
							<div className="rounded-lg border p-4">
								<QRCodeSVG value={totpUri} size={200} />
							</div>
						) : null}
					</div>
					<div className="space-y-2">
						<div className="text-sm font-medium">
							{t(
								"settings.security.twoFactor.enterAuthenticatorCode",
								"Enter the 6-digit code from your authenticator app",
							)}
						</div>
						<div className="flex justify-center">
							<InputOTP maxLength={6} value={otpValue} onChange={onOtpValueChange}>
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
					<Button variant="outline" onClick={onCancel} disabled={isPending}>
						{t("settings.security.twoFactor.cancel", "Cancel")}
					</Button>
					<Button onClick={onVerify} disabled={isPending || otpValue.length !== 6}>
						{t("settings.security.twoFactor.verifyAndEnable", "Verify and Enable")}
					</Button>
				</ActionPanelFooter>
			</ActionPanelContent>
		</ActionPanel>
	);
}

interface BackupCodesActionPanelProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	backupCodes: string[];
	onCopyCodes: () => void;
	onConfirmSaved: () => void;
	t: TranslateFn;
}

export function BackupCodesActionPanel({
	open,
	onOpenChange,
	backupCodes,
	onCopyCodes,
	onConfirmSaved,
	t,
}: BackupCodesActionPanelProps) {
	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
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
					<Button variant="outline" onClick={onCopyCodes} className="w-full">
						{t("settings.security.twoFactor.copyCodes", "Copy Codes")}
					</Button>
				</ActionPanelBody>
				<ActionPanelFooter>
					<Button onClick={onConfirmSaved}>
						{t("settings.security.twoFactor.savedCodes", "I've Saved These Codes")}
					</Button>
				</ActionPanelFooter>
			</ActionPanelContent>
		</ActionPanel>
	);
}

interface DisableTwoFactorDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	disablePassword: string;
	onDisablePasswordChange: (value: string) => void;
	onCancel: () => void;
	onConfirm: () => void;
	isPending: boolean;
	t: TranslateFn;
}

export function DisableTwoFactorDialog({
	open,
	onOpenChange,
	disablePassword,
	onDisablePasswordChange,
	onCancel,
	onConfirm,
	isPending,
	t,
}: DisableTwoFactorDialogProps) {
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
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
							aria-label={t("settings.security.twoFactor.passwordLabel", "Password")}
							autoComplete="current-password"
							value={disablePassword}
							onChange={(event) => onDisablePasswordChange(event.target.value)}
							className={TEXT_INPUT_CLASSNAME}
							placeholder={t(
								"settings.security.twoFactor.passwordPlaceholder",
								"Enter your password...",
							)}
						/>
					</div>
				</div>
				<AlertDialogFooter>
					<AlertDialogCancel onClick={onCancel} disabled={isPending}>
						{t("settings.security.twoFactor.cancel", "Cancel")}
					</AlertDialogCancel>
					<AlertDialogAction asChild>
						<Button
							variant="destructive"
							onClick={(event) => {
								event.preventDefault();
								onConfirm();
							}}
							disabled={isPending || !disablePassword}
						>
							{t("settings.security.twoFactor.disable2fa", "Disable 2FA")}
						</Button>
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
