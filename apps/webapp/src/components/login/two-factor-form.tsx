"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export type TwoFactorFormProps = {
	otpValue: string;
	fieldError?: string;
	trustDevice: boolean;
	isLoading: boolean;
	onOtpChange: (value: string) => void;
	onTrustDeviceChange: (checked: boolean) => void;
};

export function TwoFactorForm({
	otpValue,
	fieldError,
	trustDevice,
	isLoading,
	onOtpChange,
	onTrustDeviceChange,
}: TwoFactorFormProps) {
	const { t } = useTranslate();
	const input = useRef<HTMLInputElement>(null);
	useEffect(() => {
		input.current?.focus();
	}, []);

	return (
		<>
			<div className="grid gap-3">
				<Label htmlFor="otp">{t("auth.2fa-code", "Two-Factor Authentication Code")}</Label>
				<div className="flex justify-center">
					<InputOTP
						ref={input}
						id="otp"
						name="otpValue"
						inputMode="numeric"
						aria-invalid={Boolean(fieldError)}
						aria-describedby={fieldError ? "otp-error" : "otp-help"}
						autoComplete="one-time-code"
						disabled={isLoading}
						maxLength={6}
						value={otpValue}
						onChange={onOtpChange}
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
				{fieldError ? (
					<p id="otp-error" role="alert" className="text-sm text-destructive">
						{fieldError}
					</p>
				) : null}
				<p id="otp-help" className="text-sm text-muted-foreground text-center">
					{t("auth.2fa-enter-code", "Enter the 6-digit code from your authenticator app")}
				</p>
			</div>
			<div className="flex items-center justify-center gap-x-2">
				<Switch
					id="trustDevice"
					disabled={isLoading}
					checked={trustDevice}
					onCheckedChange={onTrustDeviceChange}
				/>
				<Label htmlFor="trustDevice" className="cursor-pointer">
					{t("auth.remember-device", "Remember this device for 30 days")}
				</Label>
			</div>
			<Button className="w-full" disabled={isLoading || otpValue.length !== 6} type="submit">
				{isLoading ? (
					<>
						<IconLoader2
							aria-hidden="true"
							className="size-4 animate-spin motion-reduce:animate-none"
						/>
						{t("auth.verifying", "Verifying...")}
					</>
				) : (
					t("auth.verify-and-login", "Verify and Login")
				)}
			</Button>
		</>
	);
}
