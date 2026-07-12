"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export type TwoFactorFormProps = {
	otpValue: string;
	trustDevice: boolean;
	isLoading: boolean;
	onOtpChange: (value: string) => void;
	onTrustDeviceChange: (checked: boolean) => void;
	onVerify: () => void;
};

export function TwoFactorForm({
	otpValue,
	trustDevice,
	isLoading,
	onOtpChange,
	onTrustDeviceChange,
	onVerify,
}: TwoFactorFormProps) {
	const { t } = useTranslate();

	return (
		<>
			<div className="grid gap-3">
				<Label htmlFor="otp">{t("auth.2fa-code", "Two-Factor Authentication Code")}</Label>
				<div className="flex justify-center">
					<InputOTP maxLength={6} value={otpValue} onChange={onOtpChange}>
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
				<p className="text-sm text-muted-foreground text-center">
					{t("auth.2fa-enter-code", "Enter the 6-digit code from your authenticator app")}
				</p>
			</div>
			<div className="flex items-center justify-center gap-x-2">
				<Switch id="trustDevice" checked={trustDevice} onCheckedChange={onTrustDeviceChange} />
				<Label htmlFor="trustDevice" className="cursor-pointer">
					{t("auth.remember-device", "Remember this device for 30 days")}
				</Label>
			</div>
			<Button className="w-full" disabled={isLoading || otpValue.length !== 6} onClick={onVerify}>
				{isLoading ? (
					<>
						<IconLoader2 className="size-4 animate-spin" />
						{t("auth.verifying", "Verifying...")}
					</>
				) : (
					t("auth.verify-and-login", "Verify and Login")
				)}
			</Button>
		</>
	);
}
