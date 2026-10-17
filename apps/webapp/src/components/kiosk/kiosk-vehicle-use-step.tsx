"use client";

import { IconArrowLeft, IconCar, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { type ReactNode, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type Instant, parseInstant, systemClock } from "@/lib/datetime/temporal-core";
import type { KioskEmployeeSnapshot, KioskVehicleUse } from "@/lib/time-tracking/kiosk/protocol";
import type {
	BreakVehicleUse,
	ClockVehicleUse,
} from "@/lib/time-tracking/vehicle-use/clock-vehicle-use";
import {
	organizationVehicleIdOf,
	type WorkVehicleUse,
} from "@/lib/time-tracking/vehicle-use/work-vehicle-use";
import { cn } from "@/lib/utils";
import {
	EMPTY_VEHICLE_USE_DRAFT,
	prefilledVehicleUseDraft,
	type VehicleUseDraft,
	vehicleUseFromDraft,
	withPickedVehicle,
} from "../time-tracking/vehicle-use-draft";
import { VehicleUseWarnings } from "../time-tracking/vehicle-use-fields";
import {
	formatKm,
	vehicleOptionLabel,
	vehicleUseRefusalText,
	vehicleUseText,
} from "../time-tracking/vehicle-use-format";
import {
	type KioskVehicleQuestion,
	kioskVehicleUseRequest,
	kioskVehicleUseWarnings,
} from "./kiosk-vehicle-use";

/** What the vehicle step hands to the action: the vehicle use to send, or why it is left out. */
export type KioskVehicleUseAnswer = {
	vehicleUse?: ClockVehicleUse | BreakVehicleUse;
	/** Entered vehicle use that cannot be recorded; the action runs without it. */
	leftOut: boolean;
};

interface KioskVehicleUseStepProps {
	question: KioskVehicleQuestion;
	/** Whose turn it is and their state (offline, as the kiosk believes it, #1292). */
	snapshot: Pick<KioskEmployeeSnapshot, "employee" | "state">;
	/** The snapshot's vehicle use; the kiosk asks only while it is on. */
	context: KioskVehicleUse;
	/** The action's button label, e.g. "Clock in". */
	actionLabel: string;
	pending: boolean;
	disabled: boolean;
	onConfirm: (answer: KioskVehicleUseAnswer) => void;
	onBack: () => void;
}

const NONE = "";

/** When the asked-about work starts and when the action takes effect, for the warnings. */
function workTimes(state: KioskEmployeeSnapshot["state"]): {
	since: Instant | null;
	at: Instant;
} {
	const now = systemClock.nowInstant();
	if (state.status === "clocked_out") return { since: null, at: now };
	// A day ended on a break ends at the break's start.
	const at = state.status === "on_break" ? parseInstant(state.breakSince) : now;
	return { since: parseInstant(state.since), at };
}

/**
 * The kiosk's vehicle step (#1123, spec #807), between an action's button and
 * the action: an employee whose vehicle use is asked or expected picks the
 * vehicle and enters the reading, with the web clock's pre-fill and warnings
 * (#1121, #1122). Nothing is required: no vehicle sends none, and what cannot be
 * recorded is left out while the action still runs. Touch-sized for the kiosk.
 */
export function KioskVehicleUseStep({
	question,
	snapshot,
	context,
	actionLabel,
	pending,
	disabled,
	onConfirm,
	onBack,
}: KioskVehicleUseStepProps) {
	const { t } = useTranslate();
	const locale = useLocale();
	const [draft, setDraft] = useState<VehicleUseDraft>(() =>
		question === "clock_in" ? prefilledVehicleUseDraft(context) : EMPTY_VEHICLE_USE_DRAFT,
	);
	const [reading, setReading] = useState("");
	const request = kioskVehicleUseRequest(question, context, draft, reading);
	const warnings = kioskVehicleUseWarnings(
		question,
		context,
		draft,
		reading,
		workTimes(snapshot.state),
	);
	const { live } = context;
	const asksWholeUse = question === "clock_in" || (question === "clock_out" && !live);

	function confirm() {
		onConfirm(
			request.ok
				? {
						...(request.vehicleUse ? { vehicleUse: request.vehicleUse } : {}),
						leftOut: false,
					}
				: { leftOut: true },
		);
	}

	return (
		<div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
			<Button
				variant="ghost"
				size="lg"
				className="h-14 self-start text-lg"
				disabled={pending}
				onClick={onBack}
			>
				<IconArrowLeft className="size-6" aria-hidden="true" />
				{t("timeTracking.kiosk.vehicle.back", "Back")}
			</Button>
			<div className="space-y-2 text-center">
				<h1 className="text-3xl font-semibold break-words">{snapshot.employee.name}</h1>
				<p className="flex items-center justify-center gap-2 text-2xl">
					<IconCar className="size-7 text-muted-foreground" aria-hidden="true" />
					{t("timeTracking.vehicleUse.title", "Vehicle use")}
				</p>
				{context.mode === "expected" ? (
					<p className="text-lg text-muted-foreground">
						{t(
							"timeTracking.vehicleUse.expectedHint",
							"Your organization expects you to record the vehicle you drove and its readings.",
						)}
					</p>
				) : null}
			</div>
			{asksWholeUse ? (
				<VehicleChoice
					context={context}
					value={draft.vehicle}
					onChange={(vehicle) =>
						vehicle === NONE
							? setDraft(EMPTY_VEHICLE_USE_DRAFT)
							: setDraft(withPickedVehicle(draft, vehicle, context.lastEndKmByVehicleId))
					}
					disabled={pending}
				/>
			) : live ? (
				<p className="text-center text-xl">{liveText(t, context, live, locale)}</p>
			) : null}
			<KioskVehicleReadings
				question={question}
				live={live}
				draft={draft}
				onChange={setDraft}
				reading={reading}
				onReadingChange={setReading}
				pending={pending}
			/>
			{!request.ok ? (
				<p role="alert" className="text-center text-lg text-destructive">
					{vehicleUseRefusalText(t, request.code)}
				</p>
			) : null}
			{warnings.length > 0 ? <VehicleUseWarnings warnings={warnings} t={t} /> : null}
			<Button size="lg" className="h-24 text-2xl" disabled={disabled || pending} onClick={confirm}>
				{pending ? (
					<IconLoader2
						className="size-7 animate-spin motion-reduce:animate-none"
						aria-hidden="true"
					/>
				) : null}
				{actionLabel}
			</Button>
		</div>
	);
}

function liveText(
	t: ReturnType<typeof useTranslate>["t"],
	context: KioskVehicleUse,
	use: WorkVehicleUse,
	locale: string,
) {
	const vehicleId = organizationVehicleIdOf(use);
	const vehicle = context.vehicles.find((option) => option.id === vehicleId);
	return vehicleUseText(
		t,
		{
			state: "recorded",
			vehicle:
				use.vehicle.kind === "own"
					? { kind: "own" }
					: {
							kind: "organization",
							label: vehicle ? vehicleOptionLabel(vehicle) : null,
						},
			startKm: use.startKm,
			endKm: use.endKm,
			distanceKm: use.distanceKm,
		},
		locale,
	);
}

/** The vehicles as touch-sized choices: none, the organization's (assigned first), own. */
function VehicleChoice({
	context,
	value,
	onChange,
	disabled,
}: {
	context: KioskVehicleUse;
	value: string;
	onChange: (vehicle: string) => void;
	disabled: boolean;
}) {
	const { t } = useTranslate();
	const name = useId();
	const options: { value: string; label: ReactNode }[] = [
		{
			value: NONE,
			label: t("timeTracking.vehicleUse.noVehicle", "No vehicle"),
		},
		...context.vehicles
			.filter((vehicle) => !vehicle.archived || vehicle.id === value)
			.map((vehicle) => ({
				value: vehicle.id,
				label: vehicleOptionLabel(vehicle),
			})),
		{
			value: "own",
			label: t("timeTracking.vehicleUse.ownVehicle", "Own vehicle"),
		},
	];
	return (
		<div
			role="radiogroup"
			aria-label={t("timeTracking.vehicleUse.vehicle", "Vehicle")}
			className="grid max-h-80 gap-3 overflow-y-auto sm:grid-cols-2"
		>
			{options.map((option) => (
				<label
					key={option.value || "none"}
					className={cn(
						"flex min-h-16 cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-xl",
						"has-[:checked]:border-primary has-[:checked]:bg-primary/10",
						"has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
					)}
				>
					<input
						type="radio"
						name={name}
						className="size-6 accent-primary"
						value={option.value}
						checked={value === option.value}
						onChange={() => onChange(option.value)}
						disabled={disabled}
					/>
					<span className="break-words">{option.label}</span>
				</label>
			))}
		</div>
	);
}

function Reading({
	id,
	label,
	hint,
	value,
	onChange,
	disabled,
}: {
	id: string;
	label: string;
	hint?: string;
	value: string;
	onChange: (value: string) => void;
	disabled: boolean;
}) {
	return (
		<div className="grid gap-2">
			<label htmlFor={id} className="text-lg">
				{label}
			</label>
			<Input
				id={id}
				inputMode="numeric"
				autoComplete="off"
				className="h-16 text-2xl tabular-nums md:text-2xl"
				value={value}
				onChange={(event) => onChange(event.target.value)}
				disabled={disabled}
			/>
			{hint ? <p className="text-muted-foreground">{hint}</p> : null}
		</div>
	);
}

/** The distance both readings imply, shown instead of a distance input. */
function DerivedDistance({ draft }: { draft: VehicleUseDraft }) {
	const { t } = useTranslate();
	const locale = useLocale();
	const result = vehicleUseFromDraft(draft);
	const distance = result.ok && result.use ? result.use.distanceKm : null;
	if (distance === null) return null;
	return (
		<p className="self-end text-lg text-muted-foreground" aria-live="polite">
			{t("timeTracking.vehicleUse.derivedDistance", "Driven distance: {distance} km", {
				distance: formatKm(distance, locale),
			})}
		</p>
	);
}

function KioskVehicleReadings({
	question,
	live,
	draft,
	onChange,
	reading,
	onReadingChange,
	pending,
}: {
	question: KioskVehicleQuestion;
	live: KioskVehicleUse["live"];
	draft: VehicleUseDraft;
	onChange: (value: VehicleUseDraft) => void;
	reading: string;
	onReadingChange: (value: string) => void;
	pending: boolean;
}) {
	const { t } = useTranslate();
	const id = useId();
	const asksWholeUse = question === "clock_in" || (question === "clock_out" && !live);
	const set = (patch: Partial<VehicleUseDraft>) => onChange({ ...draft, ...patch });
	return (
		<>
			{asksWholeUse && draft.vehicle !== NONE ? (
				<div className="grid gap-4 sm:grid-cols-2">
					<Reading
						id={`${id}-start`}
						label={t("timeTracking.vehicleUse.startKm", "Start reading (km)")}
						value={draft.startKm}
						onChange={(startKm) => set({ startKm })}
						disabled={pending}
					/>
					{question === "clock_out" ? (
						<>
							<Reading
								id={`${id}-end`}
								label={t("timeTracking.vehicleUse.endKm", "End reading (km)")}
								value={draft.endKm}
								onChange={(endKm) => set({ endKm })}
								disabled={pending}
							/>
							{draft.startKm.trim() === "" ? (
								<Reading
									id={`${id}-distance`}
									label={t("timeTracking.vehicleUse.distanceKm", "Driven distance (km)")}
									value={draft.distanceKm}
									onChange={(distanceKm) => set({ distanceKm })}
									disabled={pending}
								/>
							) : (
								<DerivedDistance draft={draft} />
							)}
						</>
					) : null}
				</div>
			) : null}
			{question === "clock_out" && live ? (
				live.startKm === null ? (
					<Reading
						id={`${id}-distance`}
						label={t("timeTracking.vehicleUse.distanceKm", "Driven distance (km)")}
						value={draft.distanceKm}
						onChange={(distanceKm) => set({ distanceKm })}
						disabled={pending}
					/>
				) : (
					<Reading
						id={`${id}-end`}
						label={t("timeTracking.vehicleUse.endKm", "End reading (km)")}
						value={draft.endKm}
						onChange={(endKm) => set({ endKm })}
						disabled={pending}
					/>
				)
			) : null}
			{question === "break" ? (
				<Reading
					id={`${id}-reading`}
					label={t("timeTracking.vehicleUse.breakReading", "Odometer reading at the break (km)")}
					hint={t(
						"timeTracking.vehicleUse.breakReadingHint",
						"Optional. It ends this work's reading and starts the next one's.",
					)}
					value={reading}
					onChange={onReadingChange}
					disabled={pending}
				/>
			) : null}
		</>
	);
}
