"use client";

import { IconLicense, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { TimezonePicker } from "@/components/settings/timezone-picker";
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
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import { useServerDataState } from "@/hooks/use-server-data-state";
import type {
	DrivingLicenceFeatureState,
	DrivingLicenceSetupInput,
} from "@/lib/organization/driving-licence/policy";
import {
	getDrivingLicenceReactivationImpactAction,
	switchDrivingLicenceControlAction,
} from "@/lib/organization/driving-licence/policy-actions";
import { useRouter } from "@/navigation";

type Translate = ReturnType<typeof useTranslate>["t"];

/** Where the admin continues after the first switch-on: choosing intended drivers. */
const SETUP_LANDING = "/settings/driving-licence?tab=intended-drivers";

function switchError(t: Translate, error: string) {
	switch (error) {
		case "forbidden":
			return t(
				"organization.features.driving-licence-error-forbidden",
				"You can't change driving licence control in this organization.",
			);
		case "timezone_fixed":
			return t(
				"organization.features.driving-licence-error-timezone-fixed",
				"The deadline timezone is already fixed and can't be changed.",
			);
		case "setup_required":
		case "invalid_setup":
			return t(
				"organization.features.driving-licence-error-setup",
				"Check the retention period, its justification, the check interval and the timezone.",
			);
		default:
			return t(
				"organization.features.driving-licence-error",
				"Driving licence control could not be changed. Please try again.",
			);
	}
}

/** Stands in for a rejected action call, so the busy flag resets and the generic error shows. */
const UNEXPECTED_FAILURE = { success: false, error: "unexpected" } as const;
type UnexpectedFailure = typeof UNEXPECTED_FAILURE;

/** A whole number of months from 1 to 120, or null. */
function monthsFrom(value: string) {
	if (!value.trim()) return null;
	const months = Number(value);
	return Number.isInteger(months) && months >= 1 && months <= 120 ? months : null;
}

interface DrivingLicenceFeatureProps {
	state: DrivingLicenceFeatureState;
	/** Prefills the deadline timezone on the first switch-on. */
	organizationTimezone: string;
	/** Owners and admins switch driving licence control (#1421). */
	canEdit: boolean;
}

/**
 * The Features card row for driving licence control: its only activation.
 * The first switch-on collects the setup activation needs; switching off asks first.
 */
export function DrivingLicenceFeature({
	state,
	organizationTimezone,
	canEdit,
}: DrivingLicenceFeatureProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const [isPending, startTransition] = useTransition();
	const [enabled, setEnabled] = useServerDataState(state.enabled);
	const [setupOpen, setSetupOpen] = useState(false);
	const [confirmOffOpen, setConfirmOffOpen] = useState(false);
	/** Authorizations switching on again will suspend; null while not confirming. */
	const [reactivationImpact, setReactivationImpact] = useState<number | null>(null);
	const [saving, setSaving] = useState(false);

	const submit = async (next: boolean, setup?: DrivingLicenceSetupInput) => {
		if (!canEdit) return false;
		setSaving(true);
		setEnabled(next);
		const input = setup ? { enabled: next, setup } : { enabled: next };
		let result: Awaited<ReturnType<typeof switchDrivingLicenceControlAction>> | UnexpectedFailure;
		try {
			result = await switchDrivingLicenceControlAction(input);
		} catch {
			result = UNEXPECTED_FAILURE;
		}
		setSaving(false);
		if (!result.success) {
			setEnabled(!next);
			toast.error(switchError(t, result.error));
			return false;
		}
		toast.success(
			next
				? t("organization.features.driving-licence-enabled", "Driving licence control switched on")
				: t(
						"organization.features.driving-licence-disabled",
						"Driving licence control switched off",
					),
		);
		if (result.data.firstActivation) {
			router.push(SETUP_LANDING);
		} else {
			startTransition(() => {
				router.refresh();
			});
		}
		return true;
	};

	/** Counts what switching on again suspends (#1422) before asking to confirm. */
	const askToSwitchOnAgain = async () => {
		setSaving(true);
		let impact:
			| Awaited<ReturnType<typeof getDrivingLicenceReactivationImpactAction>>
			| UnexpectedFailure;
		try {
			impact = await getDrivingLicenceReactivationImpactAction();
		} catch {
			impact = UNEXPECTED_FAILURE;
		}
		setSaving(false);
		if (!impact.success) {
			toast.error(switchError(t, impact.error));
			return;
		}
		setReactivationImpact(impact.data.suspendedAuthorizations);
	};

	const handleCheckedChange = (next: boolean) => {
		if (!canEdit) return;
		if (!next) {
			setConfirmOffOpen(true);
			return;
		}
		if (state.setupRequired) {
			setSetupOpen(true);
			return;
		}
		void askToSwitchOnAgain();
	};

	const busy = saving || isPending;

	return (
		<>
			<div className="flex items-center justify-between">
				<div className="flex items-start gap-3">
					<div className="mt-0.5 rounded-lg bg-primary/10 p-2">
						<IconLicense aria-hidden="true" className="size-5 text-primary" />
					</div>
					<div className="space-y-1">
						<Label
							htmlFor="driving-licence-toggle"
							className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
						>
							{t("organization.features.driving-licence", "Driving Licence Control")}
						</Label>
						<p className="text-sm text-muted-foreground">
							{t(
								"organization.features.driving-licence-description",
								"Have verifiers check the original driving licences of intended drivers at a fixed interval, with reminders and evidence retention.",
							)}
						</p>
					</div>
				</div>
				<div className="flex items-center gap-2">
					{busy && (
						<IconLoader2 aria-hidden="true" className="size-4 animate-spin text-muted-foreground" />
					)}
					<Switch
						id="driving-licence-toggle"
						checked={enabled}
						onCheckedChange={handleCheckedChange}
						disabled={!canEdit || busy}
						aria-label={t(
							"organization.features.toggle-driving-licence",
							"Toggle driving licence control",
						)}
					/>
				</div>
			</div>

			<Dialog open={setupOpen} onOpenChange={setSetupOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							{t(
								"organization.features.driving-licence-setup-title",
								"Switch on driving licence control",
							)}
						</DialogTitle>
						<DialogDescription>
							{t(
								"organization.features.driving-licence-setup-description",
								"Activation needs a finite, justified retention period for check evidence. Nobody is an intended driver until you assign them.",
							)}
						</DialogDescription>
					</DialogHeader>
					{setupOpen && (
						<DrivingLicenceSetupForm
							t={t}
							savedSetup={state.savedSetup}
							organizationTimezone={organizationTimezone}
							disabled={!canEdit}
							onCancel={() => setSetupOpen(false)}
							onSubmit={async (setup) => {
								if (await submit(true, setup)) setSetupOpen(false);
							}}
						/>
					)}
				</DialogContent>
			</Dialog>

			<AlertDialog open={confirmOffOpen} onOpenChange={setConfirmOffOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t(
								"organization.features.driving-licence-disable-title",
								"Switch off driving licence control?",
							)}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"organization.features.driving-licence-disable-description",
								"Intended drivers, verifier grants, check records and authorizations are kept, and deadlines keep running. Reminders and tasks stop. Evidence cleanup continues on the saved retention period.",
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
						<AlertDialogAction onClick={() => void submit(false)}>
							{t("organization.features.driving-licence-disable-confirm", "Switch off")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<AlertDialog
				open={reactivationImpact !== null}
				onOpenChange={(open) => {
					if (!open) setReactivationImpact(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t(
								"organization.features.driving-licence-enable-again-title",
								"Switch driving licence control on again?",
							)}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"organization.features.driving-licence-enable-again-impact",
								"{count, plural, =0 {No authorization will be suspended: no deadline or expiry passed while control was off.} one {# authorization will be suspended because its deadline or expiry passed while control was off.} other {# authorizations will be suspended because their deadline or expiry passed while control was off.}}",
								{ count: reactivationImpact ?? 0 },
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<p className="text-sm text-muted-foreground">
						{t(
							"organization.features.driving-licence-enable-again-description",
							"Each suspended authorization gets one suspension notice to the employee and their verifiers. Reminders that fell due while control was off aren't sent; later reminders follow the usual schedule.",
						)}
					</p>
					<AlertDialogFooter>
						<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								setReactivationImpact(null);
								void submit(true);
							}}
						>
							{t("organization.features.driving-licence-setup-confirm", "Switch on")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

function DrivingLicenceSetupForm({
	t,
	savedSetup,
	organizationTimezone,
	disabled,
	onCancel,
	onSubmit,
}: {
	t: Translate;
	savedSetup: DrivingLicenceFeatureState["savedSetup"];
	organizationTimezone: string;
	disabled: boolean;
	onCancel: () => void;
	onSubmit: (setup: DrivingLicenceSetupInput) => Promise<void>;
}) {
	const monthsError = t(
		"organization.features.driving-licence-months-error",
		"Enter 1 to 120 months.",
	);
	const form = useForm({
		defaultValues: {
			retentionMonths: "",
			retentionJustification: "",
			intervalMonths: savedSetup ? String(savedSetup.intervalMonths) : "",
			// A saved timezone is already fixed; otherwise start from the organization's.
			timezone: savedSetup?.timezone ?? organizationTimezone,
		},
		onSubmit: async ({ value }) => {
			const retentionMonths = monthsFrom(value.retentionMonths);
			const intervalMonths = monthsFrom(value.intervalMonths);
			if (disabled || retentionMonths === null || intervalMonths === null) return;
			await onSubmit({
				intervalMonths,
				timezone: value.timezone,
				retentionMonths,
				retentionJustification: value.retentionJustification.trim(),
			});
		},
	});
	const months = ({ value }: { value: string }) =>
		monthsFrom(value) === null ? monthsError : undefined;

	return (
		<form
			noValidate
			className="space-y-4"
			onSubmit={(event) => {
				// TanStack Form owns validation and the async submission; native submission would navigate away.
				// react-doctor-disable-next-line react-doctor/no-prevent-default
				event.preventDefault();
				void form.handleSubmit();
			}}
		>
			<div className="grid gap-4 sm:grid-cols-2">
				<form.Field name="retentionMonths" validators={{ onSubmit: months }}>
					{(field) => (
						<TFormItem>
							<TFormLabel hasError={fieldHasError(field)}>
								{t("organization.features.driving-licence-retention", "Retention period (months)")}
							</TFormLabel>
							<TFormControl hasError={fieldHasError(field)}>
								<Input
									name={field.name}
									type="number"
									inputMode="numeric"
									autoComplete="off"
									min={1}
									max={120}
									step={1}
									value={field.state.value}
									onChange={(event) => field.handleChange(event.target.value)}
									onBlur={field.handleBlur}
								/>
							</TFormControl>
							<TFormMessage field={field} />
						</TFormItem>
					)}
				</form.Field>
				<form.Field name="intervalMonths" validators={{ onSubmit: months }}>
					{(field) => (
						<TFormItem>
							<TFormLabel hasError={fieldHasError(field)}>
								{t(
									"organization.features.driving-licence-interval",
									"Routine check interval (months)",
								)}
							</TFormLabel>
							<TFormControl hasError={fieldHasError(field)}>
								<Input
									name={field.name}
									type="number"
									inputMode="numeric"
									autoComplete="off"
									min={1}
									max={120}
									step={1}
									value={field.state.value}
									onChange={(event) => field.handleChange(event.target.value)}
									onBlur={field.handleBlur}
								/>
							</TFormControl>
							<TFormMessage field={field} />
						</TFormItem>
					)}
				</form.Field>
			</div>
			<form.Field
				name="retentionJustification"
				validators={{
					onSubmit: ({ value }) =>
						value.trim().length < 10
							? t(
									"organization.features.driving-licence-justification-error",
									"Explain the retention period in at least 10 characters.",
								)
							: undefined,
				}}
			>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)}>
							{t("organization.features.driving-licence-justification", "Retention justification")}
						</TFormLabel>
						<TFormControl hasError={fieldHasError(field)}>
							<Textarea
								name={field.name}
								autoComplete="off"
								maxLength={2000}
								value={field.state.value}
								onChange={(event) => field.handleChange(event.target.value)}
								onBlur={field.handleBlur}
							/>
						</TFormControl>
						<TFormDescription>
							{t(
								"organization.features.driving-licence-justification-help",
								"Why evidence is kept this long after it stops supporting an authorization. Don't include private or medical details.",
							)}
						</TFormDescription>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>
			<form.Field name="timezone">
				{(field) => (
					<TFormItem>
						<TFormLabel>
							{t("organization.features.driving-licence-timezone", "Deadline timezone")}
						</TFormLabel>
						<TFormControl>
							<TimezonePicker
								value={field.state.value}
								onChange={field.handleChange}
								disabled={disabled || savedSetup !== null}
							/>
						</TFormControl>
						<TFormDescription>
							{t(
								"organization.features.driving-licence-timezone-help",
								"Deadlines use this timezone. It can't be changed after driving licence control is switched on.",
							)}
						</TFormDescription>
					</TFormItem>
				)}
			</form.Field>
			<form.Subscribe selector={(formState) => formState.isSubmitting}>
				{(pending) => (
					<DialogFooter>
						<Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button type="submit" disabled={disabled || pending}>
							{pending && <IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />}
							{t("organization.features.driving-licence-setup-confirm", "Switch on")}
						</Button>
					</DialogFooter>
				)}
			</form.Subscribe>
		</form>
	);
}
