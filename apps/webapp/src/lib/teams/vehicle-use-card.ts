/**
 * The Teams vehicle use card (#1125, spec #807; ADR 0009). A bot clock command
 * never waits for vehicle use: it commits first, and while vehicle use is asked
 * or expected for the employee its reply carries this card. Saving it records
 * vehicle use on the work the command started or closed; skipping (or ignoring
 * the card) leaves the clock command without vehicle use.
 *
 * The card's actions are Universal Actions (`Action.Execute`), whose data carries
 * the stage, the work period and what was pre-filled; Teams merges the inputs
 * into it. That data is never proof of anything: the server scopes the work to
 * the pressing employee and re-checks every rule. Pure: no I/O.
 */
import type { BotTranslateFn } from "@/lib/bot-platform/i18n";
import type { ClockVehicleUse } from "@/lib/time-tracking/vehicle-use/clock-vehicle-use";
import {
	MAX_DRIVEN_DISTANCE_KM,
	MAX_ODOMETER_KM,
	type VehicleChoice,
} from "@/lib/time-tracking/vehicle-use/work-vehicle-use";

export const TEAMS_VEHICLE_USE_VERBS = {
	save: "z8.vehicleUse.save",
	skip: "z8.vehicleUse.skip",
} as const;

export type TeamsVehicleUseStage = "clock_in" | "clock_out";

/** The committed Teams clock command a card follows. */
export type TeamsVehicleUsePromptTarget = {
	organizationId: string;
	employeeId: string;
	stage: TeamsVehicleUseStage;
	/** The committed clock entry: the clock-in that started or the clock-out that closed the work. */
	entryId: string;
};

/** What one card asks, for the work a clock command started or closed. */
export type TeamsVehicleUsePrompt = {
	stage: TeamsVehicleUseStage;
	workPeriodId: string;
	/**
	 * The clock-out entry this Teams clock-out created (clock-out only). The
	 * completion is bound to it: it fills only the work this clock-out closed
	 * (#807 decision 7), never work closed automatically, at departure or on behalf.
	 */
	clockOutEntryId: string | null;
	/** Pickable vehicles, assigned ones first; unused when the work records a vehicle. */
	vehicles: { id: string; label: string }[];
	/** The assigned vehicle pre-selected, if any. */
	suggestedVehicleId: string | null;
	/** The suggested vehicle's last end reading, pre-filling the start reading. */
	prefillStartKm: number | null;
	/**
	 * The vehicle the closed work records (clock-out only), whose drive the card
	 * ends: an organization vehicle's label, or null for the employee's own vehicle.
	 */
	recorded: { vehicleLabel: string | null; startKm: number | null } | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OWN = "own";

/** Vehicle names are data: their Markdown is shown, never rendered. */
function escapeMarkdown(value: string): string {
	return value.replace(/[\\`*_[\]~]/g, "\\$&");
}

function vehicleInput(prompt: TeamsVehicleUsePrompt, t: BotTranslateFn) {
	return {
		type: "Input.ChoiceSet",
		id: "vehicle",
		label: t("bot.vehicleUse.vehicle", "Vehicle"),
		style: "compact",
		isRequired: true,
		errorMessage: t("bot.vehicleUse.vehicleRequired", "Choose a vehicle."),
		...(prompt.suggestedVehicleId ? { value: prompt.suggestedVehicleId } : {}),
		choices: [
			...prompt.vehicles.map((vehicle) => ({ title: vehicle.label, value: vehicle.id })),
			{ title: t("bot.vehicleUse.ownVehicle", "Own vehicle"), value: OWN },
		],
	};
}

function readingInput(
	id: "startKm" | "endKm" | "distanceKm",
	label: string,
	options: { value?: number | null; min?: number; required?: boolean; errorMessage?: string },
) {
	return {
		type: "Input.Number",
		id,
		label,
		min: options.min ?? 0,
		max: id === "distanceKm" ? MAX_DRIVEN_DISTANCE_KM : MAX_ODOMETER_KM,
		...(options.value !== null && options.value !== undefined ? { value: options.value } : {}),
		...(options.required ? { isRequired: true, errorMessage: options.errorMessage ?? label } : {}),
	};
}

function promptInputs(prompt: TeamsVehicleUsePrompt, t: BotTranslateFn) {
	const startLabel = t("bot.vehicleUse.startKm", "Start reading (km)");
	const endLabel = t("bot.vehicleUse.endKm", "End reading (km)");
	if (prompt.stage === "clock_in") {
		return [
			vehicleInput(prompt, t),
			readingInput("startKm", startLabel, { value: prompt.prefillStartKm }),
		];
	}
	if (!prompt.recorded) {
		return [
			vehicleInput(prompt, t),
			readingInput("startKm", startLabel, { value: prompt.prefillStartKm }),
			readingInput("endKm", endLabel, {}),
		];
	}
	const required = t("bot.vehicleUse.readingRequired", "Enter the kilometres.");
	if (prompt.recorded.startKm !== null) {
		return [
			readingInput("endKm", endLabel, {
				min: prompt.recorded.startKm,
				required: true,
				errorMessage: required,
			}),
		];
	}
	return [
		readingInput("distanceKm", t("bot.vehicleUse.distanceKm", "Driven distance (km)"), {
			required: true,
			errorMessage: required,
		}),
	];
}

function promptText(prompt: TeamsVehicleUsePrompt, t: BotTranslateFn): string[] {
	if (prompt.stage === "clock_in") {
		return [
			t("bot.vehicleUse.clockInTitle", "Are you driving a vehicle for this work?"),
			t(
				"bot.vehicleUse.clockInHint",
				"Your clock-in is recorded. Save the vehicle and its start reading, or skip if you are not driving.",
			),
		];
	}
	if (!prompt.recorded) {
		return [
			t("bot.vehicleUse.clockOutTitle", "Did you drive a vehicle for this work?"),
			t(
				"bot.vehicleUse.clockOutHint",
				"Your clock-out is recorded. Save the vehicle and its readings, or skip if you did not drive.",
			),
		];
	}
	const vehicle =
		prompt.recorded.vehicleLabel === null
			? t("bot.vehicleUse.yourOwnVehicle", "your own vehicle")
			: escapeMarkdown(prompt.recorded.vehicleLabel);
	return [
		t("bot.vehicleUse.clockOutEndTitle", "End of your drive"),
		prompt.recorded.startKm === null
			? t(
					"bot.vehicleUse.clockOutDistanceHint",
					"Your clock-out is recorded. How far did you drive with {vehicle}?",
					{ vehicle },
				)
			: t(
					"bot.vehicleUse.clockOutEndHint",
					"Your clock-out is recorded. {vehicle} started at {startKm} km. What is the end reading?",
					{ vehicle, startKm: prompt.recorded.startKm },
				),
	];
}

/** The card a committed clock command's reply carries while vehicle use is asked or expected. */
export function teamsVehicleUseCard(
	prompt: TeamsVehicleUsePrompt,
	t: BotTranslateFn,
): Record<string, unknown> {
	const [title, hint] = promptText(prompt, t);
	const target = {
		s: prompt.stage,
		w: prompt.workPeriodId,
		...(prompt.stage === "clock_out" && prompt.clockOutEntryId
			? { c: prompt.clockOutEntryId }
			: {}),
	};
	const asksVehicle = prompt.stage === "clock_in" || !prompt.recorded;
	// What was pre-filled, so a start reading kept for another vehicle is dropped.
	const prefilled =
		asksVehicle && prompt.suggestedVehicleId
			? {
					pv: prompt.suggestedVehicleId,
					...(prompt.prefillStartKm !== null ? { pk: prompt.prefillStartKm } : {}),
				}
			: {};
	return {
		$schema: "http://adaptivecards.io/schemas/adaptive-card.json",
		type: "AdaptiveCard",
		version: "1.4",
		body: [
			{ type: "TextBlock", text: title, weight: "bolder", wrap: true },
			{ type: "TextBlock", text: hint, wrap: true, isSubtle: true },
			...promptInputs(prompt, t),
		],
		actions: [
			{
				type: "Action.Execute",
				title: t("bot.vehicleUse.save", "Save"),
				verb: TEAMS_VEHICLE_USE_VERBS.save,
				style: "positive",
				data: { ...target, ...prefilled },
			},
			{
				type: "Action.Execute",
				title: t("bot.vehicleUse.skip", "Skip"),
				verb: TEAMS_VEHICLE_USE_VERBS.skip,
				associatedInputs: "none",
				data: target,
			},
		],
	};
}

/**
 * The card that replaces a pressed vehicle use card: its outcome, no controls.
 * `warnings` are the plausibility warnings (#1121) of what was saved, under a
 * heading; they never undo the save.
 */
export function teamsVehicleUseOutcomeCard(
	text: string,
	warnings?: { title: string; lines: readonly string[] },
): Record<string, unknown> {
	const warningBlocks =
		warnings && warnings.lines.length > 0
			? [
					{
						type: "TextBlock",
						text: escapeMarkdown(warnings.title),
						weight: "bolder",
						color: "warning",
						wrap: true,
					},
					...warnings.lines.map((line) => ({
						type: "TextBlock",
						text: escapeMarkdown(line),
						color: "warning",
						wrap: true,
					})),
				]
			: [];
	return {
		$schema: "http://adaptivecards.io/schemas/adaptive-card.json",
		type: "AdaptiveCard",
		version: "1.4",
		body: [{ type: "TextBlock", text, wrap: true }, ...warningBlocks],
	};
}

/** Why a press cannot be read; the card stays so the entry can be fixed. */
export type TeamsVehicleUseEntryRejection =
	| "invalid_reading"
	| "vehicle_required"
	| "reading_required";

/** The work a card press names: a clock-out's press also names its clock-out entry. */
export type TeamsVehicleUseInvokeTarget =
	| { stage: "clock_in"; workPeriodId: string }
	| { stage: "clock_out"; workPeriodId: string; clockOutId: string };

export type TeamsVehicleUseInvoke =
	| { kind: "none" }
	| { kind: "invalid" }
	| { kind: "rejected"; code: TeamsVehicleUseEntryRejection }
	| ({ kind: "skip" } & TeamsVehicleUseInvokeTarget)
	| ({ kind: "save"; supplied: ClockVehicleUse } & TeamsVehicleUseInvokeTarget);

function record(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

/** A whole number of kilometres as Teams sends it (a number or its text); undefined when empty. */
function kilometres(value: unknown): number | undefined | "invalid" {
	if (value === undefined || value === null) return undefined;
	if (typeof value === "number")
		return Number.isSafeInteger(value) && value >= 0 ? value : "invalid";
	if (typeof value !== "string") return "invalid";
	const text = value.trim();
	if (text === "") return undefined;
	return /^\d{1,9}$/.test(text) ? Number(text) : "invalid";
}

function vehicleChoice(value: unknown): VehicleChoice | undefined | "invalid" {
	if (value === undefined || value === null || value === "") return undefined;
	if (value === OWN) return { kind: "own" };
	if (typeof value === "string" && UUID.test(value)) {
		return { kind: "organization", vehicleId: value.toLowerCase() };
	}
	return "invalid";
}

function choiceValue(choice: VehicleChoice): string {
	return choice.kind === "own" ? OWN : choice.vehicleId;
}

/**
 * Reads a vehicle use card press: an `adaptiveCard/action` invoke for an
 * `Action.Execute` with one of our verbs and a manual trigger. Anything else
 * carrying our verbs is invalid and changes nothing.
 */
export function parseTeamsVehicleUseInvoke(activity: {
	type?: unknown;
	name?: unknown;
	value?: unknown;
}): TeamsVehicleUseInvoke {
	if (activity.type !== "invoke") return { kind: "none" };
	const value = record(activity.value);
	const action = record(value?.action);
	const verb = action?.verb;
	if (verb !== TEAMS_VEHICLE_USE_VERBS.save && verb !== TEAMS_VEHICLE_USE_VERBS.skip) {
		return { kind: "none" };
	}
	if (
		activity.name !== "adaptiveCard/action" ||
		action?.type !== "Action.Execute" ||
		value?.trigger !== "manual"
	) {
		return { kind: "invalid" };
	}
	const data = record(action.data);
	if (!data) return { kind: "invalid" };
	const stage = data.s;
	const workPeriodId = data.w;
	if (
		(stage !== "clock_in" && stage !== "clock_out") ||
		typeof workPeriodId !== "string" ||
		!UUID.test(workPeriodId)
	) {
		return { kind: "invalid" };
	}
	let target: TeamsVehicleUseInvokeTarget;
	if (stage === "clock_out") {
		// A clock-out card is bound to the clock-out entry its Teams clock-out created.
		const clockOutId = data.c;
		if (typeof clockOutId !== "string" || !UUID.test(clockOutId)) return { kind: "invalid" };
		target = {
			stage,
			workPeriodId: workPeriodId.toLowerCase(),
			clockOutId: clockOutId.toLowerCase(),
		};
	} else {
		target = { stage, workPeriodId: workPeriodId.toLowerCase() };
	}
	if (verb === TEAMS_VEHICLE_USE_VERBS.skip) return { kind: "skip", ...target };

	const vehicle = vehicleChoice(data.vehicle);
	const startKm = kilometres(data.startKm);
	const endKm = kilometres(data.endKm);
	const distanceKm = kilometres(data.distanceKm);
	if (vehicle === "invalid") return { kind: "rejected", code: "vehicle_required" };
	if (startKm === "invalid" || endKm === "invalid" || distanceKm === "invalid") {
		return { kind: "rejected", code: "invalid_reading" };
	}
	if (!vehicle && (stage === "clock_in" || startKm !== undefined)) {
		return { kind: "rejected", code: "vehicle_required" };
	}
	if (!vehicle && endKm === undefined && distanceKm === undefined) {
		return { kind: "rejected", code: "reading_required" };
	}
	// A pre-filled start reading belongs to the pre-selected vehicle only.
	const prefilledForOther =
		vehicle !== undefined &&
		data.pv !== undefined &&
		choiceValue(vehicle) !== String(data.pv).toLowerCase() &&
		startKm !== undefined &&
		startKm === kilometres(data.pk);
	const supplied: ClockVehicleUse = {
		...(vehicle ? { vehicle } : {}),
		...(startKm !== undefined && !prefilledForOther ? { startKm } : {}),
		...(endKm !== undefined ? { endKm } : {}),
		...(distanceKm !== undefined ? { distanceKm } : {}),
	};
	return { kind: "save", ...target, supplied };
}
