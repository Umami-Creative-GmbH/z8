"use client";

import { IconCar, IconCheck, IconLoader2, IconPencil, IconX } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { TFnType } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";
import {
	type ClockVehicleUseContext,
	changeLiveVehicleUse,
	getClockVehicleUseContext,
	getClockVehicleUseStatus,
} from "@/app/[locale]/(app)/time-tracking/actions/clock-vehicle-use";
import { checkVehicleUseWarnings } from "@/app/[locale]/(app)/time-tracking/actions/vehicle-use-warnings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/lib/auth-client";
import { queryKeys } from "@/lib/query/keys";
import type { WorkVehicleUse } from "@/lib/time-tracking/vehicle-use/work-vehicle-use";
import { isWorkVehicleUseRefusalCode } from "@/lib/time-tracking/vehicle-use/work-vehicle-use-refusals";
import { ClockChoiceReadError } from "./clock-choice-read-error";
import {
	breakClosingVehicleUse,
	breakVehicleUseFromReading,
	clockInVehicleUseFromDraft,
	clockOutVehicleUseFromDraft,
	closingVehicleUse,
} from "./clock-vehicle-use-draft";
import { useVehicleUseWarnings } from "./use-vehicle-use-warnings";
import {
	EMPTY_VEHICLE_USE_DRAFT,
	prefilledVehicleUseDraft,
	type VehicleUseDraft,
	vehicleUseDraftOf,
	vehicleUseFromDraft,
} from "./vehicle-use-draft";
import { VehicleUseFields, VehicleUseWarnings } from "./vehicle-use-fields";
import { vehicleOptionLabel, vehicleUseRefusalText, vehicleUseText } from "./vehicle-use-format";

/**
 * Vehicle use at the web clock (#1122, spec #807): what the popover and the
 * widget ask according to the employee's mode. Clock-in asks for the vehicle and
 * start reading (pre-filled, #1121); clock-out for the end reading, or the
 * distance without a start reading; a break for one optional reading. While
 * clocked in, the live work's vehicle and start reading can be changed. Nothing
 * here ever holds or refuses a clock event: what cannot be sent is left out.
 *
 * The context stays cached, so an offline clock-in still asks with the last
 * known vehicles; warnings need a connection and are only advice.
 */
function useClockVehicleContext(enabled: boolean, choicesEnabled: boolean) {
	const { data: session, isPending } = useSession();
	const scope = {
		userId: session?.user.id ?? null,
		organizationId: session?.session.activeOrganizationId ?? null,
		isLoading: isPending,
	};
	const allowed = enabled && !!scope.userId && !!scope.organizationId && !scope.isLoading;
	const choicesKey = queryKeys.timeClock.vehicleUse(scope.userId, scope.organizationId);
	const operationalKey = queryKeys.timeClock.vehicleUseStatus(scope.userId, scope.organizationId);
	const operational = useQuery({
		queryKey: operationalKey,
		queryFn: async () => {
			const result = await getClockVehicleUseStatus();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: allowed,
		staleTime: 60_000,
		retry: false,
	});
	const needsChoices =
		operational.data?.mode !== "off" ||
		operational.data.live?.vehicleUse?.vehicle.kind === "organization";
	const query = useQuery({
		queryKey: choicesKey,
		queryFn: async (): Promise<ClockVehicleUseContext> => {
			const result = await getClockVehicleUseContext();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: allowed && choicesEnabled && needsChoices,
		staleTime: 60_000,
		retry: false,
	});

	const status =
		operational.data && operational.dataUpdatedAt >= query.dataUpdatedAt
			? operational.data
			: (query.data ?? operational.data);
	const context: ClockVehicleUseContext | null = status
		? { ...(query.data ?? { vehicles: [] }), ...status }
		: null;
	return { query, operational, status, context, choicesKey, operationalKey };
}

export function useClockVehicleUse({
	enabled,
	choicesEnabled = true,
}: {
	enabled: boolean;
	choicesEnabled?: boolean;
}) {
	const queryClient = useQueryClient();
	const { query, operational, status, context, choicesKey, operationalKey } =
		useClockVehicleContext(enabled, choicesEnabled);
	const mode = context?.mode ?? "off";
	const live = context?.live?.vehicleUse ?? null;
	// Untouched, the clock-in shows the pre-filled draft (#1121).
	const [clockInEdit, setClockInDraft] = useState<VehicleUseDraft | null>(null);
	const [clockOutDraft, setClockOutDraft] = useState<VehicleUseDraft>(EMPTY_VEHICLE_USE_DRAFT);
	const [breakReading, setBreakReading] = useState("");
	const clockInDraft =
		clockInEdit ?? (context ? prefilledVehicleUseDraft(context) : EMPTY_VEHICLE_USE_DRAFT);

	const clockIn = clockInVehicleUseFromDraft(clockInDraft);
	const clockOut = clockOutVehicleUseFromDraft(clockOutDraft, live);
	const takenBreak = breakVehicleUseFromReading(breakReading, live);

	return {
		context,
		choicesLoading: query.isLoading,
		choicesError: query.isError,
		choicesUnavailable: choicesEnabled && !query.data && query.isPaused,
		operationalError: operational.isError && !status,
		operationalLoading: operational.isPending && !status,
		retryChoices: () => query.refetch(),
		retryOperational: () => operational.refetch(),
		mode,
		/** Whether the clock asks for vehicle use at all. */
		asks: mode !== "off",
		live,
		liveWorkPeriodId: context?.live?.workPeriodId ?? null,
		clockInDraft,
		setClockInDraft,
		clockOutDraft,
		setClockOutDraft,
		breakReading,
		setBreakReading,
		/** What a clock-in, clock-out or break sends; never anything while vehicle use is off. */
		clockIn: mode === "off" ? { ok: true as const } : clockIn,
		clockOut: mode === "off" ? { ok: true as const } : clockOut,
		takenBreak: mode === "off" ? { ok: true as const } : takenBreak,
		/** Forgets what was entered, after the clock event it belonged to. */
		reset() {
			setClockInDraft(null);
			setClockOutDraft(EMPTY_VEHICLE_USE_DRAFT);
			setBreakReading("");
		},
		refresh() {
			return Promise.all([
				queryClient.invalidateQueries({ queryKey: choicesKey }),
				queryClient.invalidateQueries({ queryKey: operationalKey }),
			]);
		},
	};
}

export type ClockVehicleUseState = ReturnType<typeof useClockVehicleUse>;

function ClockVehicleChoiceStatus({ state, t }: { state: ClockVehicleUseState; t: TFnType }) {
	if (state.operationalLoading)
		return (
			<p role="status" className="text-xs text-muted-foreground">
				{t("timeTracking.vehicleUse.settingsLoading", "Loading vehicle-use settings…")}
			</p>
		);
	if (state.operationalError)
		return (
			<ClockChoiceReadError
				label={t("timeTracking.vehicleUse.title", "Vehicle use")}
				retry={() => void state.retryOperational()}
			/>
		);
	if (!state.asks) return null;
	if (state.choicesError)
		return (
			<ClockChoiceReadError
				label={t("timeTracking.vehicleUse.choices", "Vehicle choices")}
				retry={() => void state.retryChoices()}
			/>
		);
	if (state.choicesLoading || state.choicesUnavailable)
		return (
			<p role="status" className="text-xs text-muted-foreground">
				{state.choicesUnavailable
					? t(
							"timeTracking.vehicleUse.choicesOffline",
							"Vehicle choices are unavailable offline. You can record time and add details later.",
						)
					: t("timeTracking.vehicleUse.choicesLoading", "Loading vehicle choices…")}
			</p>
		);
	return null;
}

export function ClockInVehicleUse(props: Parameters<typeof ClockInVehicleUseFields>[0]) {
	return (
		<>
			<ClockVehicleChoiceStatus state={props.state} t={props.t} />
			<ClockInVehicleUseFields {...props} />
		</>
	);
}
export function ClockOutVehicleUse(props: Parameters<typeof ClockOutVehicleUseFields>[0]) {
	return (
		<>
			<ClockVehicleChoiceStatus state={props.state} t={props.t} />
			<ClockOutVehicleUseFields {...props} />
		</>
	);
}

function vehicleLabel(context: ClockVehicleUseContext | null, use: WorkVehicleUse) {
	if (use.vehicle.kind === "own") return null;
	const { vehicleId } = use.vehicle;
	const vehicle = context?.vehicles.find((option) => option.id === vehicleId);
	return vehicle ? vehicleOptionLabel(vehicle) : null;
}

function liveText(t: TFnType, state: ClockVehicleUseState, use: WorkVehicleUse, locale: string) {
	return vehicleUseText(
		t,
		{
			state: "recorded",
			vehicle:
				use.vehicle.kind === "own"
					? { kind: "own" }
					: { kind: "organization", label: vehicleLabel(state.context, use) },
			startKm: use.startKm,
			endKm: use.endKm,
			distanceKm: use.distanceKm,
		},
		locale,
	);
}

/** Plausibility warnings (#1121) for what a clock event is about to record. */
function useClockWarnings(
	use: {
		vehicleUse: Parameters<typeof checkVehicleUseWarnings>[0]["vehicleUse"];
		closing?: string;
	} | null,
) {
	const request = use ? JSON.stringify(use) : null;
	return useVehicleUseWarnings(request, async () => {
		if (!use) return [];
		const result = await checkVehicleUseWarnings({
			vehicleUse: use.vehicleUse,
			...(use.closing ? { closingWorkPeriodId: use.closing } : {}),
		});
		return result.success ? result.data.warnings : [];
	});
}

/** The clock-in's vehicle and start reading, asked per mode. */
function ClockInVehicleUseFields({
	state,
	disabled,
	t,
}: {
	state: ClockVehicleUseState;
	disabled?: boolean;
	t: TFnType;
}) {
	const draft = vehicleUseFromDraft({
		...state.clockInDraft,
		endKm: "",
		distanceKm: "",
	});
	const warnings = useClockWarnings(
		state.asks && draft.ok && draft.input ? { vehicleUse: draft.input } : null,
	);
	if (!state.asks || !state.context) return null;
	return (
		<VehicleUseFields
			value={state.clockInDraft}
			onChange={state.setClockInDraft}
			vehicles={state.context.vehicles}
			lastEndKmByVehicleId={state.context.lastEndKmByVehicleId}
			warnings={warnings}
			expected={state.mode === "expected"}
			readings="start"
			disabled={disabled}
			t={t}
		/>
	);
}

/**
 * The clock-out's end reading (or distance), with the live work's vehicle use and
 * a way to change its vehicle or start reading while clocked in.
 */
function ClockOutVehicleUseFields({
	state,
	disabled,
	t,
}: {
	state: ClockVehicleUseState;
	disabled?: boolean;
	t: TFnType;
}) {
	const [editing, setEditing] = useState(false);
	const { live } = state;
	const closingUse =
		state.asks && state.liveWorkPeriodId && state.clockOut.ok && state.clockOut.vehicleUse
			? closingVehicleUse(live, state.clockOutDraft)
			: null;
	const warnings = useClockWarnings(
		closingUse && state.liveWorkPeriodId
			? { vehicleUse: closingUse, closing: state.liveWorkPeriodId }
			: null,
	);
	if (!state.context) return null;
	if (!live) {
		if (!state.asks) return null;
		return (
			<VehicleUseFields
				value={state.clockOutDraft}
				onChange={state.setClockOutDraft}
				vehicles={state.context.vehicles}
				lastEndKmByVehicleId={state.context.lastEndKmByVehicleId}
				warnings={warnings}
				expected={state.mode === "expected"}
				disabled={disabled}
				t={t}
			/>
		);
	}
	if (editing && state.asks && state.liveWorkPeriodId) {
		return (
			<LiveVehicleUseEditor
				state={state}
				workPeriodId={state.liveWorkPeriodId}
				live={live}
				onDone={() => setEditing(false)}
				t={t}
			/>
		);
	}
	return (
		<LiveVehicleUseClosing
			state={state}
			live={live}
			disabled={disabled}
			t={t}
			warnings={warnings}
			onEdit={() => setEditing(true)}
		/>
	);
}

function LiveVehicleUseClosing({
	state,
	live,
	disabled,
	t,
	warnings,
	onEdit,
}: {
	state: ClockVehicleUseState;
	live: WorkVehicleUse;
	disabled?: boolean;
	t: TFnType;
	warnings: Parameters<typeof VehicleUseWarnings>[0]["warnings"];
	onEdit: () => void;
}) {
	const id = useId();
	const locale = useLocale();
	const startMissing = live.startKm === null;
	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between gap-2">
				<p className="flex min-w-0 items-center gap-1.5 text-sm">
					<IconCar className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
					<span className="truncate">{liveText(t, state, live, locale)}</span>
				</p>
				{state.asks ? (
					<Button
						type="button"
						size="sm"
						variant="ghost"
						className="h-7 px-2"
						onClick={onEdit}
						disabled={disabled}
					>
						<IconPencil className="size-3.5" aria-hidden="true" />
						{t("timeTracking.vehicleUse.changeLive", "Change")}
					</Button>
				) : null}
			</div>
			{state.asks ? (
				<div className="grid gap-1.5">
					<Label htmlFor={`${id}-closing`} className="text-xs text-muted-foreground">
						{startMissing
							? t("timeTracking.vehicleUse.distanceKm", "Driven distance (km)")
							: t("timeTracking.vehicleUse.endKm", "End reading (km)")}
					</Label>
					<Input
						id={`${id}-closing`}
						inputMode="numeric"
						autoComplete="off"
						value={startMissing ? state.clockOutDraft.distanceKm : state.clockOutDraft.endKm}
						onChange={(event) =>
							state.setClockOutDraft({
								...state.clockOutDraft,
								...(startMissing
									? { distanceKm: event.target.value }
									: { endKm: event.target.value }),
							})
						}
						disabled={disabled}
					/>
					{!state.clockOut.ok ? (
						<p className="text-xs text-destructive" role="alert">
							{vehicleUseRefusalText(t, state.clockOut.code)}
						</p>
					) : null}
					{warnings.length > 0 ? <VehicleUseWarnings warnings={warnings} t={t} /> : null}
				</div>
			) : null}
		</div>
	);
}

/** Changes the live work's vehicle or start reading (a live attribution amendment). */
function LiveVehicleUseEditor({
	state,
	workPeriodId,
	live,
	onDone,
	t,
}: {
	state: ClockVehicleUseState;
	workPeriodId: string;
	live: WorkVehicleUse;
	onDone: () => void;
	t: TFnType;
}) {
	const [draft, setDraft] = useState<VehicleUseDraft>(() => ({
		...vehicleUseDraftOf(live),
		endKm: "",
		distanceKm: "",
	}));
	const [saving, setSaving] = useState(false);
	const result = vehicleUseFromDraft({ ...draft, endKm: "", distanceKm: "" });
	// Over the live work so far: a start reading below the vehicle's last end reading warns (#1121).
	const warnings = useClockWarnings(
		result.ok && result.input ? { vehicleUse: result.input, closing: workPeriodId } : null,
	);
	const context = state.context;
	if (!context) return null;

	async function save() {
		if (!result.ok) return;
		setSaving(true);
		const saved = await changeLiveVehicleUse({
			workPeriodId,
			vehicleUse: result.input
				? {
						vehicle: result.input.vehicle,
						startKm: result.input.startKm ?? null,
					}
				: null,
		}).catch(() => null);
		setSaving(false);
		if (saved?.success) {
			toast.success(t("timeTracking.vehicleUse.liveChanged", "Vehicle use changed"));
			await state.refresh();
			onDone();
			return;
		}
		const code = saved && !saved.success ? saved.code : undefined;
		toast.error(
			code && isWorkVehicleUseRefusalCode(code)
				? vehicleUseRefusalText(t, code)
				: t("timeTracking.vehicleUse.liveChangeFailed", "The vehicle use could not be changed"),
		);
	}

	return (
		<div className="space-y-2 rounded-md border p-2">
			<VehicleUseFields
				value={draft}
				onChange={setDraft}
				vehicles={context.vehicles}
				lastEndKmByVehicleId={context.lastEndKmByVehicleId}
				warnings={warnings}
				expected={state.mode === "expected"}
				readings="start"
				disabled={saving}
				t={t}
			/>
			<div className="flex gap-2">
				<Button type="button" size="sm" onClick={save} disabled={saving || !result.ok}>
					{saving ? (
						<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
					) : (
						<IconCheck className="size-4" aria-hidden="true" />
					)}
					{t("common.save", "Save")}
				</Button>
				<Button type="button" size="sm" variant="outline" onClick={onDone} disabled={saving}>
					<IconX className="size-4" aria-hidden="true" />
					{t("common.cancel", "Cancel")}
				</Button>
			</div>
		</div>
	);
}

/** A break's one optional odometer reading, while the live work records a vehicle. */
export function BreakVehicleReading({
	state,
	disabled,
	t,
}: {
	state: ClockVehicleUseState;
	disabled?: boolean;
	t: TFnType;
}) {
	const id = useId();
	// The reading ends the work the break closes: warned about as its end reading (#1121).
	const closingUse = state.asks ? breakClosingVehicleUse(state.live, state.breakReading) : null;
	const warnings = useClockWarnings(
		closingUse && state.takenBreak.ok && state.liveWorkPeriodId
			? { vehicleUse: closingUse, closing: state.liveWorkPeriodId }
			: null,
	);
	if (!state.asks || !state.live) return null;
	return (
		<div className="grid gap-1.5">
			<Label htmlFor={`${id}-reading`} className="text-xs text-muted-foreground">
				{t("timeTracking.vehicleUse.breakReading", "Odometer reading at the break (km)")}
			</Label>
			<Input
				id={`${id}-reading`}
				inputMode="numeric"
				autoComplete="off"
				value={state.breakReading}
				onChange={(event) => state.setBreakReading(event.target.value)}
				disabled={disabled}
			/>
			<p className="text-xs text-muted-foreground">
				{t(
					"timeTracking.vehicleUse.breakReadingHint",
					"Optional. It ends this work's reading and starts the next one's.",
				)}
			</p>
			{!state.takenBreak.ok ? (
				<p className="text-xs text-destructive" role="alert">
					{vehicleUseRefusalText(t, state.takenBreak.code)}
				</p>
			) : null}
			{warnings.length > 0 ? <VehicleUseWarnings warnings={warnings} t={t} /> : null}
		</div>
	);
}
