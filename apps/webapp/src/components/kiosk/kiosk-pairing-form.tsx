"use client";

import { IconDeviceTablet, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
} from "@/components/ui/tanstack-form";
import { type KioskPairingResult, pairKioskDevice } from "@/lib/kiosk/device";
import type { KioskDeviceInfo } from "@/lib/kiosk/protocol";

interface KioskPairingFormProps {
	initialCode: string;
	onPaired: (token: string, kiosk: KioskDeviceInfo) => void;
}

type PairingFailure = Exclude<KioskPairingResult["status"], "paired">;

/** Pairs an unpaired device with the code an admin issued in settings. */
export function KioskPairingForm({ initialCode, onPaired }: KioskPairingFormProps) {
	const { t } = useTranslate();
	const [failure, setFailure] = useState<PairingFailure | null>(null);
	const [pairing, setPairing] = useState(false);

	const form = useForm({
		defaultValues: { code: initialCode },
		onSubmit: async ({ value }) => {
			setPairing(true);
			setFailure(null);
			const result = await pairKioskDevice(value.code);
			setPairing(false);
			if (result.status === "paired") {
				onPaired(result.token, result.kiosk);
				return;
			}
			setFailure(result.status);
		},
	});

	function failureMessage(reason: PairingFailure): string {
		switch (reason) {
			case "malformed_code":
				return t(
					"timeTracking.kiosk.pairing.malformedCode",
					"Enter the 10-character code exactly as shown in settings.",
				);
			case "invalid_code":
				return t(
					"timeTracking.kiosk.pairing.invalidCode",
					"This code is invalid or has expired. Ask your admin for a new pairing code.",
				);
			case "rate_limited":
				return t(
					"timeTracking.kiosk.pairing.rateLimited",
					"Too many attempts. Wait a few minutes, then try again.",
				);
			case "unreachable":
				return t(
					"timeTracking.kiosk.pairing.unreachable",
					"The kiosk cannot reach the server. Check the network connection and try again.",
				);
		}
	}

	return (
		<div className="m-auto w-full max-w-md space-y-8">
			<div className="space-y-3 text-center">
				<IconDeviceTablet className="mx-auto size-14 text-primary" aria-hidden="true" />
				<h1 className="text-3xl font-semibold">
					{t("timeTracking.kiosk.pairing.title", "Set up this kiosk")}
				</h1>
				<p className="text-muted-foreground">
					{t(
						"timeTracking.kiosk.pairing.description",
						"An owner or admin creates the kiosk in Settings › Kiosks and gives you a pairing code.",
					)}
				</p>
			</div>
			{/* Client-side TanStack Form submit (docs/refs/forms.md). */}
			{/* react-doctor-disable-next-line react-doctor/no-prevent-default */}
			<form
				className="space-y-6"
				noValidate
				onSubmit={(event) => {
					event.preventDefault();
					void form.handleSubmit();
				}}
			>
				<form.Field name="code">
					{(field) => (
						<TFormItem>
							<TFormLabel className="text-base">
								{t("timeTracking.kiosk.pairing.codeLabel", "Pairing code")}
							</TFormLabel>
							<TFormControl hasError={failure !== null}>
								<Input
									value={field.state.value}
									onChange={(event) => field.handleChange(event.target.value)}
									onBlur={field.handleBlur}
									autoComplete="off"
									autoCapitalize="characters"
									autoCorrect="off"
									spellCheck={false}
									placeholder="ABCDE-FGHJK"
									className="h-16 text-center font-mono text-2xl tracking-widest uppercase"
								/>
							</TFormControl>
							<TFormDescription>
								{t(
									"timeTracking.kiosk.pairing.codeDescription",
									"The code works once and expires 10 minutes after it was issued.",
								)}
							</TFormDescription>
						</TFormItem>
					)}
				</form.Field>
				{failure ? (
					<p role="alert" className="text-center text-sm text-destructive">
						{failureMessage(failure)}
					</p>
				) : null}
				<Button type="submit" size="lg" className="h-14 w-full text-lg" disabled={pairing}>
					{pairing ? <IconLoader2 className="size-5 animate-spin" aria-hidden="true" /> : null}
					{t("timeTracking.kiosk.pairing.submit", "Pair this device")}
				</Button>
			</form>
		</div>
	);
}
