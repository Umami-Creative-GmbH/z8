"use client";

import { IconCar } from "@tabler/icons-react";
import type { TFnType } from "@tolgee/react";
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
import type {
	WorkVehicleOption,
	WorkVehicleUse,
} from "@/lib/time-tracking/vehicle-use/work-vehicle-use";
import type { VehicleUseDraft } from "./vehicle-use-draft";
import { vehicleUseFromDraft } from "./vehicle-use-draft";
import { vehicleUseRefusalText, vehicleUseText } from "./vehicle-use-format";

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
	expected = false,
	disabled = false,
	t,
}: {
	value: VehicleUseDraft;
	onChange: (value: VehicleUseDraft) => void;
	vehicles: WorkVehicleOption[];
	/** Vehicle use expected: the employee is asked every time (never required). */
	expected?: boolean;
	disabled?: boolean;
	t: TFnType;
}) {
	const id = useId();
	const result = vehicleUseFromDraft(value);
	const hasVehicle = value.vehicle !== "";
	const startMissing = value.startKm.trim() === "";
	const derived = result.ok && result.use && !startMissing ? result.use.distanceKm : null;
	const selectable = vehicles.filter((vehicle) => !vehicle.archived || vehicle.id === value.vehicle);
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
							: set({ vehicle: next })
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
												? `${vehicle.name} (${vehicle.licencePlate})`
												: t("timeTracking.vehicleUse.unknownVehicle", "Unknown vehicle (unavailable)");
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
								{`${vehicle.name} (${vehicle.licencePlate})`}
								{vehicle.archived
									? ` · ${t("timeTracking.vehicleUse.archived", "archived")}`
									: ""}
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
					{startMissing ? (
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
								distance: derived.toLocaleString(),
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
		</fieldset>
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
	return (
		<div className="space-y-1">
			<p className="text-sm text-muted-foreground">
				{t("timeTracking.vehicleUse.title", "Vehicle use")}
			</p>
			<p className="flex items-center gap-1.5 text-sm">
				<IconCar className="size-4 text-muted-foreground" aria-hidden="true" />
				{vehicleUseText(t, {
					state: "recorded",
					vehicle:
						use.vehicle.kind === "own" ? { kind: "own" } : { kind: "organization", label: vehicleLabel },
					startKm: use.startKm,
					endKm: use.endKm,
					distanceKm: use.distanceKm,
				})}
			</p>
		</div>
	);
}
