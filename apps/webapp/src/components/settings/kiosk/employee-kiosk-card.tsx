"use client";

import {
	IconDeviceTablet,
	IconKey,
	IconLoader2,
	IconLockOpen,
	IconMail,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";
import {
	addKioskOnlyEmployeeEmailAction,
	type EmployeeKioskState,
	getEmployeeKioskStateAction,
	issueEmployeeKioskPinAction,
	resetEmployeeKioskPinAction,
	unlockEmployeeKioskPinAction,
} from "@/app/[locale]/(app)/settings/employees/kiosk-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { KioskPinActionResult } from "@/lib/time-tracking/kiosk/pin-errors";
import { kioskPinErrorMessage } from "./kiosk-pin-error-message";

type Translate = ReturnType<typeof useTranslate>["t"];

function kioskStateKey(employeeId: string) {
	return ["kiosk", "employee-state", employeeId] as const;
}

function lockedUntilLabel(iso: string): string {
	return Temporal.Instant.from(iso).toLocaleString(undefined, {
		hour: "2-digit",
		minute: "2-digit",
	});
}

/**
 * Kiosk access on the employee detail page (#857): the employee's kiosk PIN
 * for owners, admins and their direct manager (issue, reset, unlock; a
 * generated PIN is shown once), and for kiosk-only employees, adding a real
 * email. Renders nothing for anyone else.
 */
export function EmployeeKioskCard({ employeeId }: { employeeId: string }) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const stateQuery = useQuery({
		queryKey: kioskStateKey(employeeId),
		queryFn: async () => {
			const result = await getEmployeeKioskStateAction(employeeId);
			return result.success ? result.data : null;
		},
	});
	const state = stateQuery.data;
	if (!state) return null;

	const refresh = () => queryClient.invalidateQueries({ queryKey: kioskStateKey(employeeId) });

	return (
		<Card>
			<CardHeader className="space-y-2">
				<div className="flex items-start gap-3">
					<div className="mt-0.5 rounded-md border bg-muted p-2 text-muted-foreground">
						<IconDeviceTablet className="size-4" aria-hidden="true" />
					</div>
					<div className="min-w-0 space-y-1">
						<CardTitle className="flex flex-wrap items-center gap-2">
							{t("settings.employees.kioskPin.title", "Kiosk access")}
							{state.kioskOnly && (
								<Badge variant="secondary">
									{t("settings.employees.kioskPin.kioskOnlyBadge", "Kiosk only")}
								</Badge>
							)}
						</CardTitle>
						<CardDescription>
							{state.kioskOnly
								? t(
										"settings.employees.kioskPin.kioskOnlyDescription",
										"This employee has no email and no sign-in. They clock only at kiosks with their PIN.",
									)
								: t(
										"settings.employees.kioskPin.description",
										"The personal PIN this employee enters to clock at a kiosk.",
									)}
						</CardDescription>
					</div>
				</div>
			</CardHeader>
			<CardContent className="space-y-6">
				{state.canManagePin && (
					<KioskPinSection employeeId={employeeId} state={state} onChanged={refresh} t={t} />
				)}
				{state.canAddEmail && <AddEmailSection employeeId={employeeId} onAdded={refresh} t={t} />}
			</CardContent>
		</Card>
	);
}

function KioskPinSection({
	employeeId,
	state,
	onChanged,
	t,
}: {
	employeeId: string;
	state: EmployeeKioskState;
	onChanged: () => Promise<unknown>;
	t: Translate;
}) {
	const [shownPin, setShownPin] = useState<string | null>(null);
	const [confirmingReset, setConfirmingReset] = useState(false);

	const handleResult = <T,>(result: KioskPinActionResult<T>, onSuccess: (data: T) => void) => {
		if (result.success) {
			onSuccess(result.data);
			void onChanged();
		} else {
			toast.error(kioskPinErrorMessage(t, result.code));
		}
	};

	const pinMutation = useMutation({
		mutationFn: (kind: "issue" | "reset") =>
			kind === "issue"
				? issueEmployeeKioskPinAction(employeeId)
				: resetEmployeeKioskPinAction(employeeId),
		onSuccess: (result) => {
			setConfirmingReset(false);
			handleResult(result, (data) => setShownPin(data.pin));
		},
		onError: () => toast.error(kioskPinErrorMessage(t, "failed")),
	});
	const unlockMutation = useMutation({
		mutationFn: () => unlockEmployeeKioskPinAction(employeeId),
		onSuccess: (result) =>
			handleResult(result, () =>
				toast.success(t("settings.employees.kioskPin.unlocked", "Kiosk PIN unlocked")),
			),
		onError: () => toast.error(kioskPinErrorMessage(t, "failed")),
	});
	const busy = pinMutation.isPending || unlockMutation.isPending;

	return (
		<section className="space-y-3" aria-labelledby={`kiosk-pin-${employeeId}`}>
			<h3 id={`kiosk-pin-${employeeId}`} className="flex items-center gap-2 text-sm font-medium">
				<IconKey className="size-4 text-muted-foreground" aria-hidden="true" />
				{t("settings.employees.kioskPin.pinHeading", "Kiosk PIN")}
			</h3>
			<p className="text-sm text-muted-foreground" aria-live="polite">
				{state.lockedUntil
					? t(
							"settings.employees.kioskPin.lockedUntil",
							"Locked after too many wrong PINs until {time}.",
							{ time: lockedUntilLabel(state.lockedUntil) },
						)
					: state.hasPin
						? t("settings.employees.kioskPin.hasPin", "A kiosk PIN is set.")
						: t("settings.employees.kioskPin.noPin", "No kiosk PIN yet.")}
			</p>

			{shownPin && (
				<div className="space-y-2 rounded-md border bg-muted/50 p-3" role="status">
					<p className="text-sm">
						{t(
							"settings.employees.kioskPin.shownOnce",
							"Give this PIN to the employee now. It is shown only once.",
						)}
					</p>
					<p className="font-mono text-2xl tracking-[0.3em]">{shownPin}</p>
					<Button size="sm" variant="outline" onClick={() => setShownPin(null)}>
						{t("settings.employees.kioskPin.done", "Done")}
					</Button>
				</div>
			)}

			<div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
				{!state.hasPin ? (
					<Button onClick={() => pinMutation.mutate("issue")} disabled={busy}>
						{pinMutation.isPending && <IconLoader2 className="mr-2 size-4 animate-spin" />}
						{t("settings.employees.kioskPin.issue", "Issue PIN")}
					</Button>
				) : confirmingReset ? (
					<>
						<Button variant="outline" onClick={() => setConfirmingReset(false)} disabled={busy}>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button onClick={() => pinMutation.mutate("reset")} disabled={busy}>
							{pinMutation.isPending && <IconLoader2 className="mr-2 size-4 animate-spin" />}
							{t("settings.employees.kioskPin.confirmReset", "Replace the PIN")}
						</Button>
					</>
				) : (
					<Button variant="outline" onClick={() => setConfirmingReset(true)} disabled={busy}>
						{t("settings.employees.kioskPin.reset", "Reset PIN")}
					</Button>
				)}
				{state.lockedUntil && (
					<Button variant="outline" onClick={() => unlockMutation.mutate()} disabled={busy}>
						<IconLockOpen className="mr-2 size-4" aria-hidden="true" />
						{t("settings.employees.kioskPin.unlock", "Unlock")}
					</Button>
				)}
			</div>
		</section>
	);
}

function AddEmailSection({
	employeeId,
	onAdded,
	t,
}: {
	employeeId: string;
	onAdded: () => Promise<unknown>;
	t: Translate;
}) {
	const addMutation = useMutation({
		mutationFn: (email: string) => addKioskOnlyEmployeeEmailAction({ employeeId, email }),
		onError: () => toast.error(kioskPinErrorMessage(t, "failed")),
	});
	const form = useForm({
		defaultValues: { email: "" },
		onSubmit: async ({ value }) => {
			const result = await addMutation.mutateAsync(value.email).catch(() => null);
			if (!result) return;
			if (!result.success) {
				toast.error(kioskPinErrorMessage(t, result.code));
				return;
			}
			if (result.data.invitationSent) {
				toast.success(
					t("settings.employees.kioskPin.emailAdded", "Email added. The invitation is on its way."),
				);
			} else {
				toast.warning(
					t(
						"settings.employees.kioskPin.emailAddedNotSent",
						"Email added, but the invitation could not be sent. The employee can use Forgot password with this address.",
					),
				);
			}
			form.reset();
			await onAdded();
		},
	});

	return (
		<form
			className="space-y-3"
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
		>
			<div className="space-y-1">
				<h3 className="flex items-center gap-2 text-sm font-medium">
					<IconMail className="size-4 text-muted-foreground" aria-hidden="true" />
					{t("settings.employees.kioskPin.addEmailHeading", "Add an email")}
				</h3>
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.employees.kioskPin.addEmailDescription",
						"They receive an invitation to choose a password and can then sign in. Their kiosk PIN and history stay as they are.",
					)}
				</p>
			</div>
			<form.Field name="email">
				{(field) => (
					<div className="space-y-2">
						<Label htmlFor={`kiosk-email-${employeeId}`}>
							{t("settings.employees.kioskPin.emailLabel", "Email address")}
						</Label>
						<Input
							id={`kiosk-email-${employeeId}`}
							type="email"
							autoComplete="off"
							value={field.state.value}
							onChange={(event) => field.handleChange(event.target.value)}
							required
						/>
					</div>
				)}
			</form.Field>
			<Button type="submit" disabled={addMutation.isPending}>
				{addMutation.isPending && <IconLoader2 className="mr-2 size-4 animate-spin" />}
				{t("settings.employees.kioskPin.addEmailSubmit", "Add email and invite")}
			</Button>
		</form>
	);
}
