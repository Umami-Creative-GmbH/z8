"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	createKioskAction,
	type IssuedPairingCodeData,
	type KioskData,
	type KioskLocationOption,
	updateKioskAction,
} from "@/app/[locale]/(app)/settings/kiosks/actions";
import { TimezonePicker } from "@/components/settings/timezone-picker";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { kioskSettingsErrorMessage } from "./kiosk-format";

const NAME_MAX_LENGTH = 100;

type KioskFormDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	locations: KioskLocationOption[];
} & (
	| {
			mode: "create";
			/** The organization's zone, the default zone of a new kiosk. */
			defaultTimezone: string;
			onCreated: (issued: IssuedPairingCodeData, kioskName: string) => void;
	  }
	| { mode: "edit"; kiosk: KioskData; onSaved: () => void }
);

type KioskFormValues = {
	name: string;
	locationId: string;
	timezone: string;
	boardEnabled: boolean;
};

/** Creates a kiosk, or edits one: name, location, zone and (when editing) the who-is-in board. */
export function KioskFormDialog(props: KioskFormDialogProps) {
	// Remount per opening so a reopened dialog starts from fresh defaults.
	const key = props.mode === "edit" ? `edit:${props.kiosk.id}` : `create:${String(props.open)}`;
	return <KioskFormDialogContent key={key} {...props} />;
}

function KioskFormDialogContent(props: KioskFormDialogProps) {
	const { t } = useTranslate();
	const [saving, setSaving] = useState(false);
	const editing = props.mode === "edit" ? props.kiosk : null;

	const form = useForm({
		defaultValues: {
			name: editing?.name ?? "",
			locationId: editing?.locationId ?? props.locations[0]?.id ?? "",
			// A new kiosk starts in the organization's zone, never the admin's browser zone.
			timezone: props.mode === "edit" ? props.kiosk.timezone : props.defaultTimezone,
			boardEnabled: editing?.boardEnabled ?? false,
		} satisfies KioskFormValues,
		onSubmit: async ({ value }) => {
			setSaving(true);
			try {
				if (props.mode === "create") {
					const result = await createKioskAction({
						name: value.name.trim(),
						locationId: value.locationId,
						timezone: value.timezone,
					});
					if (!result.success) {
						toast.error(
							kioskSettingsErrorMessage(t, result.code) ??
								t("settings.kiosks.createFailed", "The kiosk could not be created"),
						);
						return;
					}
					toast.success(t("settings.kiosks.created", "Kiosk created"));
					props.onCreated(result.data, value.name.trim());
					return;
				}
				const result = await updateKioskAction({
					kioskId: props.kiosk.id,
					name: value.name.trim(),
					locationId: value.locationId,
					timezone: value.timezone,
					boardEnabled: value.boardEnabled,
				});
				if (!result.success) {
					toast.error(
						kioskSettingsErrorMessage(t, result.code) ??
							t("settings.kiosks.saveFailed", "The kiosk could not be saved"),
					);
					return;
				}
				toast.success(t("settings.kiosks.saved", "Kiosk saved"));
				props.onSaved();
			} finally {
				setSaving(false);
			}
		},
	});

	return (
		<Dialog open={props.open} onOpenChange={props.onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{editing
							? t("settings.kiosks.editTitle", "Edit kiosk")
							: t("settings.kiosks.createTitle", "Add kiosk")}
					</DialogTitle>
					<DialogDescription>
						{editing
							? t("settings.kiosks.editDescription", "Changes apply to the kiosk's next request.")
							: t(
									"settings.kiosks.createDescription",
									"You receive a pairing code to enter on the kiosk device.",
								)}
					</DialogDescription>
				</DialogHeader>
				{/* Client-side TanStack Form submit (docs/refs/forms.md). */}
				{/* react-doctor-disable-next-line react-doctor/no-prevent-default */}
				<form
					className="space-y-4"
					noValidate
					onSubmit={(event) => {
						event.preventDefault();
						void form.handleSubmit();
					}}
				>
					<form.Field
						name="name"
						validators={{
							onSubmit: ({ value }) => {
								const length = value.trim().length;
								return length === 0 || length > NAME_MAX_LENGTH
									? t("settings.kiosks.errors.invalidName", "Enter a name of up to 100 characters.")
									: undefined;
							},
						}}
					>
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)}>
									{t("settings.kiosks.fields.name", "Name")}
								</TFormLabel>
								<TFormControl hasError={fieldHasError(field)}>
									<Input
										value={field.state.value}
										maxLength={NAME_MAX_LENGTH}
										placeholder={t("settings.kiosks.fields.namePlaceholder", "e.g. Staff entrance")}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
									/>
								</TFormControl>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>
					<form.Field name="locationId">
						{(field) => (
							<TFormItem>
								<TFormLabel>{t("settings.kiosks.fields.location", "Location")}</TFormLabel>
								<Select
									value={field.state.value}
									onValueChange={(value) => field.handleChange(value ?? "")}
								>
									<TFormControl>
										<SelectTrigger>
											<SelectValue
												placeholder={t(
													"settings.kiosks.fields.locationPlaceholder",
													"Choose a location",
												)}
											>
												{props.locations.find((option) => option.id === field.state.value)?.name}
											</SelectValue>
										</SelectTrigger>
									</TFormControl>
									<SelectContent>
										{props.locations.map((option) => (
											<SelectItem key={option.id} value={option.id}>
												{option.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<TFormDescription>
									{t(
										"settings.kiosks.fields.locationDescription",
										"The kiosk accepts only employees assigned to this location.",
									)}
								</TFormDescription>
							</TFormItem>
						)}
					</form.Field>
					<form.Field name="timezone">
						{(field) => (
							<TFormItem>
								<TFormLabel>{t("settings.kiosks.fields.timezone", "Time zone")}</TFormLabel>
								<TimezonePicker value={field.state.value} onChange={field.handleChange} />
								<TFormDescription>
									{t(
										"settings.kiosks.fields.timezoneDescription",
										"Clock events recorded at this kiosk use this zone.",
									)}
								</TFormDescription>
							</TFormItem>
						)}
					</form.Field>
					{editing ? (
						<form.Field name="boardEnabled">
							{(field) => (
								<TFormItem className="flex flex-row items-center justify-between gap-4 rounded-md border p-3">
									<div className="space-y-1">
										<TFormLabel>{t("settings.kiosks.fields.board", "Who-is-in board")}</TFormLabel>
										<TFormDescription>
											{t(
												"settings.kiosks.fields.boardDescription",
												"Shows on the kiosk who is in or on break, by first name and last initial.",
											)}
										</TFormDescription>
									</div>
									<TFormControl>
										<Switch
											checked={field.state.value}
											onCheckedChange={(checked) => field.handleChange(checked === true)}
										/>
									</TFormControl>
								</TFormItem>
							)}
						</form.Field>
					) : null}
					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button type="submit" disabled={saving}>
							{saving ? <IconLoader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
							{editing
								? t("settings.kiosks.save", "Save")
								: t("settings.kiosks.create", "Create kiosk")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
