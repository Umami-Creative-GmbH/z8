import { IconCar } from "@tabler/icons-react";
import {
	useVehicleUseWarnings,
	type VehicleUseState,
	type VehicleUseWarning,
	warningsSubject,
} from "../hooks/useVehicleUse";
import { useI18n } from "../lib/i18n";
import type { VehicleUseRefusal } from "../lib/vehicle-use";
import type { WorkVehicleUse } from "../types";

type Translate = (message: string) => string;

const fill = (
	language: string,
	message: string,
	values: Record<string, number>,
) =>
	Object.entries(values).reduce(
		(text, [key, value]) =>
			text.replace(`{${key}}`, value.toLocaleString(language)),
		message,
	);

export function vehicleUseRefusalText(
	t: Translate,
	code: VehicleUseRefusal,
): string {
	switch (code) {
		case "end_before_start":
			return t("The end reading cannot be below the start reading.");
		case "invalid_reading":
			return t("Enter odometer readings in whole kilometres.");
		case "invalid_distance":
			return t("Enter the driven distance in whole kilometres.");
		case "invalid_vehicle":
			return t("Choose an organization vehicle or your own vehicle.");
	}
}

function warningText(
	t: Translate,
	language: string,
	warning: VehicleUseWarning,
): string {
	switch (warning.code) {
		case "start_below_last_end":
			return fill(
				language,
				t(
					"The start reading is below this vehicle's last recorded end reading ({km} km).",
				),
				{ km: warning.lastRecordedEndKm },
			);
		case "vehicle_on_other_live_work":
			return t(
				"This vehicle is already recorded on another employee's running work.",
			);
		case "speed_above_limit":
			return fill(
				language,
				t(
					"The driven distance implies an average of {speed} km/h over this work period, more than 150 km/h.",
				),
				{ speed: warning.averageKmh },
			);
		case "distance_above_limit":
			return fill(
				language,
				t("{km} km is more than 1,500 km in one work period."),
				{
					km: warning.distanceKm,
				},
			);
	}
}

function Warnings({ warnings }: { warnings: VehicleUseWarning[] }) {
	const { t, language } = useI18n();
	if (warnings.length === 0) return null;
	return (
		<div
			className="vehicle-use-warnings"
			role="status"
			aria-label={t("Please check the vehicle use")}
		>
			{warnings.map((warning) => (
				<p key={warning.code} className="field-hint">
					{warningText(t, language, warning)}
				</p>
			))}
		</div>
	);
}

function Refusal({
	result,
}: {
	result: { ok: true } | { ok: false; code: VehicleUseRefusal };
}) {
	const { t } = useI18n();
	return result.ok ? null : (
		<p role="alert" className="login-error">
			{vehicleUseRefusalText(t, result.code)}
		</p>
	);
}

function Heading({ state }: { state: VehicleUseState }) {
	const { t } = useI18n();
	return (
		<>
			<div className="work-location-label">
				<IconCar size={14} aria-hidden="true" />
				<span>{t("Vehicle use")}</span>
			</div>
			{state.expected && (
				<p className="field-hint">
					{t(
						"Your organization expects you to record the vehicle you drove and its readings.",
					)}
				</p>
			)}
		</>
	);
}

function KmField({
	state,
	name,
	label,
	disabled,
}: {
	state: VehicleUseState;
	name: "startKm" | "endKm" | "distanceKm" | "breakKm";
	label: string;
	disabled: boolean;
}) {
	return (
		<state.form.Field name={name}>
			{(field) => (
				<label className="form-field">
					{label}
					<input
						name={field.name}
						inputMode="numeric"
						autoComplete="off"
						value={field.state.value}
						disabled={disabled}
						onChange={(event) => field.handleChange(event.target.value)}
					/>
				</label>
			)}
		</state.form.Field>
	);
}

function VehiclePicker({
	state,
	disabled,
	readings,
}: {
	state: VehicleUseState;
	disabled: boolean;
	readings: "start" | "all";
}) {
	const { t } = useI18n();
	const { vehicle, startKm } = state.values;
	return (
		<>
			<label className="form-field">
				{t("Vehicle")}
				<select
					name="vehicle"
					value={vehicle}
					disabled={disabled}
					onChange={(event) => state.pickVehicle(event.target.value)}
				>
					<option value="">{t("No vehicle")}</option>
					<option value="own">{t("Own vehicle")}</option>
					{state.vehicles.map((option) => (
						<option key={option.id} value={option.id}>
							{option.name} ({option.licencePlate})
						</option>
					))}
				</select>
			</label>
			<KmField
				state={state}
				name="startKm"
				label={t("Start reading (km)")}
				disabled={disabled}
			/>
			{readings === "all" && (
				<KmField
					state={state}
					name={startKm.trim() === "" ? "distanceKm" : "endKm"}
					label={t(
						startKm.trim() === "" ? "Driven distance (km)" : "End reading (km)",
					)}
					disabled={disabled}
				/>
			)}
		</>
	);
}

/** The clock-in's vehicle and start reading, asked per mode. */
export function ClockInVehicleUse({
	state,
	disabled,
}: {
	state: VehicleUseState;
	disabled: boolean;
}) {
	const warnings = useVehicleUseWarnings(
		state.asks ? warningsSubject(state.clockIn, null) : null,
	);
	if (!state.asks) return null;
	return (
		<div className="attribution-fields vehicle-use-fields">
			<Heading state={state} />
			<VehiclePicker state={state} disabled={disabled} readings="start" />
			<Refusal result={state.clockIn} />
			<Warnings warnings={warnings} />
		</div>
	);
}

function liveText(
	t: Translate,
	language: string,
	state: VehicleUseState,
	live: WorkVehicleUse,
): string {
	const vehicle =
		live.vehicle.kind === "own"
			? t("Own vehicle")
			: (() => {
					const { vehicleId } = live.vehicle;
					const found = state.vehicles.find(
						(option) => option.id === vehicleId,
					);
					return found
						? `${found.name} (${found.licencePlate})`
						: t("Organization vehicle");
				})();
	return live.startKm === null
		? vehicle
		: `${vehicle} · ${fill(language, t("from {km} km"), { km: live.startKm })}`;
}

/**
 * The clock-out's end reading, or the distance while the live work has no start
 * reading. Clocked in without vehicle use, the whole vehicle use is asked.
 * A manual break sends the same reading: it ends this work and starts the next.
 */
export function ClockOutVehicleUse({
	state,
	disabled,
}: {
	state: VehicleUseState;
	disabled: boolean;
}) {
	const { t, language } = useI18n();
	const warnings = useVehicleUseWarnings(
		state.asks ? warningsSubject(state.clockOut, state.live) : null,
		state.liveWorkPeriodId,
	);
	if (!state.asks) return null;
	const { live } = state;
	return (
		<div className="attribution-fields vehicle-use-fields">
			<Heading state={state} />
			{live ? (
				<>
					<p className="field-hint">{liveText(t, language, state, live)}</p>
					<KmField
						state={state}
						name={live.startKm === null ? "distanceKm" : "endKm"}
						label={t(
							live.startKm === null
								? "Driven distance (km)"
								: "End reading (km)",
						)}
						disabled={disabled}
					/>
				</>
			) : (
				<VehiclePicker state={state} disabled={disabled} readings="all" />
			)}
			<Refusal result={state.clockOut} />
			<Warnings warnings={warnings} />
		</div>
	);
}

/** An idle break's one optional reading, while the live work records a vehicle. */
export function BreakVehicleReading({
	state,
	disabled,
}: {
	state: VehicleUseState;
	disabled: boolean;
}) {
	const { t } = useI18n();
	if (!state.asks || !state.live) return null;
	return (
		<div className="vehicle-use-fields">
			<KmField
				state={state}
				name="breakKm"
				label={t("Odometer reading at the break (km)")}
				disabled={disabled}
			/>
			<p className="field-hint">
				{t("Optional. It ends this work's reading and starts the next one's.")}
			</p>
			<Refusal result={state.takenBreak} />
		</div>
	);
}
