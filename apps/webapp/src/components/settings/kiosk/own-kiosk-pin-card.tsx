"use client";

import { IconDeviceTablet, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import {
	getOwnKioskPinStatusAction,
	setOwnKioskPinAction,
} from "@/app/[locale]/(app)/settings/security/kiosk-pin-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isValidKioskPin, KIOSK_PIN_MAX_LENGTH } from "@/lib/time-tracking/kiosk/pin";
import { kioskPinErrorMessage } from "./kiosk-pin-error-message";

const OWN_PIN_STATUS_KEY = ["kiosk", "own-pin-status"] as const;

function FieldErrors({ errors }: { errors: unknown[] }) {
	const messages = errors.filter((error): error is string => typeof error === "string");
	if (messages.length === 0) return null;
	return <p className="text-sm text-destructive">{messages[0]}</p>;
}

/**
 * Lets a signed-in employee set or change their own kiosk PIN (#857). Shown
 * only to users with an employee profile in the active organization.
 */
export function OwnKioskPinCard() {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const statusQuery = useQuery({
		queryKey: OWN_PIN_STATUS_KEY,
		queryFn: async () => {
			const result = await getOwnKioskPinStatusAction();
			return result.success ? result.data : null;
		},
	});
	const saveMutation = useMutation({
		mutationFn: (pin: string) => setOwnKioskPinAction(pin),
		onError: () => toast.error(kioskPinErrorMessage(t, "failed")),
	});
	const form = useForm({
		defaultValues: { pin: "", confirmation: "" },
		onSubmit: async ({ value }) => {
			const result = await saveMutation.mutateAsync(value.pin).catch(() => null);
			if (!result) return;
			if (!result.success) {
				toast.error(kioskPinErrorMessage(t, result.code));
				return;
			}
			toast.success(t("settings.security.kioskPin.saved", "Kiosk PIN saved"));
			form.reset();
			await queryClient.invalidateQueries({ queryKey: OWN_PIN_STATUS_KEY });
		},
	});

	const status = statusQuery.data;
	if (!status?.hasEmployee) return null;

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconDeviceTablet className="size-5" aria-hidden="true" />
					{t("settings.security.kioskPin.title", "Kiosk PIN")}
				</CardTitle>
				<CardDescription>
					{status.hasPin
						? t(
								"settings.security.kioskPin.descriptionChange",
								"You have a kiosk PIN. Choose a new one of 4 to 6 digits to replace it.",
							)
						: t(
								"settings.security.kioskPin.descriptionSet",
								"Choose a PIN of 4 to 6 digits to clock at your organization's kiosks.",
							)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					className="space-y-4"
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void form.handleSubmit();
					}}
				>
					<form.Field
						name="pin"
						validators={{
							onSubmit: ({ value }) =>
								isValidKioskPin(value)
									? undefined
									: t("settings.kioskPin.errors.invalidPin", "A kiosk PIN has 4 to 6 digits."),
						}}
					>
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor="own-kiosk-pin">
									{t("settings.security.kioskPin.newPin", "New PIN")}
								</Label>
								<Input
									id="own-kiosk-pin"
									type="password"
									inputMode="numeric"
									autoComplete="off"
									maxLength={KIOSK_PIN_MAX_LENGTH}
									value={field.state.value}
									onChange={(event) => field.handleChange(event.target.value)}
								/>
								<FieldErrors errors={field.state.meta.errors} />
							</div>
						)}
					</form.Field>
					<form.Field
						name="confirmation"
						validators={{
							onSubmit: ({ value, fieldApi }) =>
								value === fieldApi.form.getFieldValue("pin")
									? undefined
									: t("settings.security.kioskPin.mismatch", "The PINs do not match."),
						}}
					>
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor="own-kiosk-pin-confirmation">
									{t("settings.security.kioskPin.repeatPin", "Repeat PIN")}
								</Label>
								<Input
									id="own-kiosk-pin-confirmation"
									type="password"
									inputMode="numeric"
									autoComplete="off"
									maxLength={KIOSK_PIN_MAX_LENGTH}
									value={field.state.value}
									onChange={(event) => field.handleChange(event.target.value)}
								/>
								<FieldErrors errors={field.state.meta.errors} />
							</div>
						)}
					</form.Field>
					<Button type="submit" disabled={saveMutation.isPending}>
						{saveMutation.isPending && <IconLoader2 className="mr-2 size-4 animate-spin" />}
						{t("settings.security.kioskPin.save", "Save PIN")}
					</Button>
				</form>
			</CardContent>
		</Card>
	);
}
