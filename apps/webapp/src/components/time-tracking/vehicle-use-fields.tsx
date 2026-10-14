"use client";

import { IconAlertTriangle, IconCar } from "@tabler/icons-react";
import type { TFnType } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type { VehicleUseWarning } from "@/lib/time-tracking/vehicle-use/plausibility";
import type {
	WorkVehicleOption,
	WorkVehicleUse,
	WorkVehicleUseFormContext,
	WorkVehicleUseInput,
} from "@/lib/time-tracking/vehicle-use/work-vehicle-use";
import { useVehicleUseWarnings } from "./use-vehicle-use-warnings";
import type { VehicleUseDraft } from "./vehicle-use-draft";
import { vehicleUseFromDraft, withPickedVehicle } from "./vehicle-use-draft";
import {
	formatKm,
	vehicleOptionLabel,
	vehicleUseRefusalText,
	vehicleUseText,
	vehicleUseWarningText,
} from "./vehicle-use-format";

const NONE = "none";

/**
 * Vehicle, odometer readings and driven distance for one work period (#1120).
 * The distance is derived from both readings; only while the start reading is
 * missing can it be entered directly. An archived vehicle is offered only when
 * it is already the recorded one.
 */
export function VehicleUseFields({
	value,
	onChange,
	vehicles,
	lastEndKmByVehicleId,
	warnings = [],
	expected = false,
	disabled = false,
	readings = "all",
	t,
}: {
	value: VehicleUseDraft;
	onChange: (value: VehicleUseDraft) => void;
	vehicles: WorkVehicleOption[];
	/** Each vehicle's last recorded end reading: pre-fills the start reading on pick (#1121). */
	lastEndKmByVehicleId?: Record<string, number>;
	/** Plausibility warnings for the entered vehicle use (#1121); they never block saving. */
	warnings?: VehicleUseWarning[];
	/** Vehicle use expected: the employee is asked every time (never required). */
	expected?: boolean;
	disabled?: boolean;
	/**
	 * Which readings to ask: all of them, or only the start reading, as a
	 * clock-in and a change of live work do (#1122).
	 */
	readings?: "all" | "start";
	t: TFnType;
}) {
	const id = useId();
	const locale = useLocale();
	const onlyStart = readings === "start";
	const result = vehicleUseFromDraft(value);
	const hasVehicle = value.vehicle !== "";
	const startMissing = value.startKm.trim() === "";
	const derived = result.ok && result.use && !startMissing ? result.use.distanceKm : null;
	const selectable = vehicles.filter(
		(vehicle) => !vehicle.archived || vehicle.id === value.vehicle,
	);
	const set = (patch: Partial<VehicleUseDraft>) => onChange({ ...value, ...patch });

	return (
		<fieldset className="space-y-2" disabled={disabled}>
			<legend className="flex items-center gap-1.5 text-sm font-medium">
				<IconCar className="size-4 text-muted-foreground" aria-hidden="true" />
				{t("timeTracking.vehicleUse.title", "Vehicle use")}
			</legend>
			{expected ? (
				<p className="text-xs text-muted-foreground">
					{t(
						"timeTracking.vehicleUse.expectedHint",
						"Your organization expects you to record the vehicle you drove and its readings.",
					)}
				</p>
			) : null}
			<div className="grid gap-1.5">
				<Label htmlFor={`${id}-vehicle`} className="text-xs text-muted-foreground">
					{t("timeTracking.vehicleUse.vehicle", "Vehicle")}
				</Label>
				<Select
					value={value.vehicle || NONE}
					onValueChange={(next: string) =>
						next === NONE
							? onChange({ vehicle: "", startKm: "", endKm: "", distanceKm: "" })
							: onChange(withPickedVehicle(value, next, lastEndKmByVehicleId))
					}
					disabled={disabled}
				>
					<SelectTrigger id={`${id}-vehicle`} className="w-full">
						<SelectValue>
							{value.vehicle === "own"
								? t("timeTracking.vehicleUse.ownVehicle", "Own vehicle")
								: value.vehicle
									? (() => {
											const vehicle = vehicles.find((option) => option.id === value.vehicle);
											return vehicle
												? vehicleOptionLabel(vehicle)
												: t(
														"timeTracking.vehicleUse.unknownVehicle",
														"Unknown vehicle (unavailable)",
													);
										})()
									: t("timeTracking.vehicleUse.noVehicle", "No vehicle")}
						</SelectValue>
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={NONE}>
							{t("timeTracking.vehicleUse.noVehicle", "No vehicle")}
						</SelectItem>
						<SelectItem value="own">
							{t("timeTracking.vehicleUse.ownVehicle", "Own vehicle")}
						</SelectItem>
						{selectable.map((vehicle) => (
							<SelectItem key={vehicle.id} value={vehicle.id}>
								{vehicleOptionLabel(vehicle)}
								{vehicle.archived ? ` · ${t("timeTracking.vehicleUse.archived", "archived")}` : ""}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			{hasVehicle ? (
				<div className="grid grid-cols-2 gap-2">
					<div className="grid gap-1.5">
						<Label htmlFor={`${id}-start`} className="text-xs text-muted-foreground">
							{t("timeTracking.vehicleUse.startKm", "Start reading (km)")}
						</Label>
						<Input
							id={`${id}-start`}
							inputMode="numeric"
							autoComplete="off"
							value={value.startKm}
							onChange={(event) => set({ startKm: event.target.value })}
						/>
					</div>
					{onlyStart ? null : (
						<div className="grid gap-1.5">
							<Label htmlFor={`${id}-end`} className="text-xs text-muted-foreground">
								{t("timeTracking.vehicleUse.endKm", "End reading (km)")}
							</Label>
							<Input
								id={`${id}-end`}
								inputMode="numeric"
								autoComplete="off"
								value={value.endKm}
								onChange={(event) => set({ endKm: event.target.value })}
							/>
						</div>
					)}
					{onlyStart ? null : startMissing ? (
						<div className="col-span-2 grid gap-1.5">
							<Label htmlFor={`${id}-distance`} className="text-xs text-muted-foreground">
								{t("timeTracking.vehicleUse.distanceKm", "Driven distance (km)")}
							</Label>
							<Input
								id={`${id}-distance`}
								inputMode="numeric"
								autoComplete="off"
								value={value.distanceKm}
								onChange={(event) => set({ distanceKm: event.target.value })}
							/>
						</div>
					) : derived !== null ? (
						<p className="col-span-2 text-xs text-muted-foreground" aria-live="polite">
							{t("timeTracking.vehicleUse.derivedDistance", "Driven distance: {distance} km", {
								distance: formatKm(derived, locale),
							})}
						</p>
					) : null}
				</div>
			) : null}
			{!result.ok ? (
				<p className="text-xs text-destructive" role="alert">
					{vehicleUseRefusalText(t, result.code)}
				</p>
			) : null}
			{result.ok && result.use && warnings.length > 0 ? (
				<VehicleUseWarnings warnings={warnings} t={t} />
			) : null}
		</fieldset>
	);
}

/**
 * Vehicle use fields with their plausibility warnings (#1121), checked on the
 * server for what is entered: a manual entry over its entered times, an edit
 * over the times as edited. `checkFor` names the check of entered vehicle use
 * (its identity and how to run it), or null to check nothing yet. Warnings
 * never block saving.
 */
export function CheckedVehicleUseFields({
	value,
	onChange,
	context,
	checkFor,
	disabled = false,
	t,
}: {
	value: VehicleUseDraft;
	onChange: (value: VehicleUseDraft) => void;
	context: Pick<WorkVehicleUseFormContext, "mode" | "vehicles" | "lastEndKmByVehicleId">;
	checkFor: (
		input: WorkVehicleUseInput,
	) => { key: string; run: () => Promise<VehicleUseWarning[]> } | null;
	disabled?: boolean;
	t: TFnType;
}) {
	const entered = vehicleUseFromDraft(value);
	const check = entered.ok && entered.input ? checkFor(entered.input) : null;
	const warnings = useVehicleUseWarnings(check?.key ?? null, async () =>
		check ? check.run() : [],
	);
	return (
		<VehicleUseFields
			value={value}
			onChange={onChange}
			vehicles={context.vehicles}
			lastEndKmByVehicleId={context.lastEndKmByVehicleId}
			warnings={warnings}
			expected={context.mode === "expected"}
			disabled={disabled}
			t={t}
		/>
	);
}

/** Plausibility warnings for entered vehicle use (#1121); saving still succeeds. */
export function VehicleUseWarnings({ warnings, t }: { warnings: VehicleUseWarning[]; t: TFnType }) {
	const locale = useLocale();
	return (
		<div
			role="status"
			aria-label={t("timeTracking.vehicleUse.warning.title", "Please check the vehicle use")}
			className="space-y-1 rounded-md border border-amber-500/40 bg-amber-50 px-2.5 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
		>
			{warnings.map((warning) => (
				<p key={warning.code} className="flex items-start gap-1.5">
					<IconAlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
					<span>{vehicleUseWarningText(t, warning, locale)}</span>
				</p>
			))}
		</div>
	);
}

/** Recorded vehicle use, read-only (e.g. while the organization switch is off). */
export function VehicleUseSummary({
	use,
	vehicleLabel,
	t,
}: {
	use: WorkVehicleUse;
	vehicleLabel: string | null;
	t: TFnType;
}) {
	const locale = useLocale();
	return (
		<div className="space-y-1">
			<p className="text-sm text-muted-foreground">
				{t("timeTracking.vehicleUse.title", "Vehicle use")}
			</p>
			<p className="flex items-center gap-1.5 text-sm">
				<IconCar className="size-4 text-muted-foreground" aria-hidden="true" />
				{vehicleUseText(
					t,
					{
						state: "recorded",
						vehicle:
							use.vehicle.kind === "own"
								? { kind: "own" }
								: { kind: "organization", label: vehicleLabel },
						startKm: use.startKm,
						endKm: use.endKm,
						distanceKm: use.distanceKm,
					},
					locale,
				)}
			</p>
		</div>
	);
}
