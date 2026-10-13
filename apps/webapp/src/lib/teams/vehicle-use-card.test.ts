import { describe, expect, it } from "vitest";
import {
	parseTeamsVehicleUseInvoke,
	TEAMS_VEHICLE_USE_VERBS,
	type TeamsVehicleUsePrompt,
	teamsVehicleUseCard,
	teamsVehicleUseOutcomeCard,
} from "./vehicle-use-card";

const van = "0b9f8f2e-6c1d-4d6c-9a43-7f2f3c1f5e10";
const truck = "5c0e7d1a-2b3c-4d5e-8f90-a1b2c3d4e5f6";
const work = "8f0c4f8e-1f1e-4c39-9f0e-2d1a3b4c5d6e";
const clockOut = "3d2c1b0a-9f8e-4d7c-8b6a-5f4e3d2c1b0a";

const t = (_key: string, fallback: string, params?: Record<string, string | number>) =>
	fallback.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? ""));

type Element = Record<string, unknown>;

function inputs(card: Record<string, unknown>): Element[] {
	return (card.body as Element[]).filter((element) => String(element.type).startsWith("Input."));
}

function action(card: Record<string, unknown>, verb: string): Element {
	const found = (card.actions as Element[]).find((candidate) => candidate.verb === verb);
	if (!found) throw new Error(`No ${verb} action`);
	return found;
}

function invoke(
	verb: string,
	data: Record<string, unknown>,
	overrides: Record<string, unknown> = {},
) {
	return {
		type: "invoke",
		name: "adaptiveCard/action",
		value: { action: { type: "Action.Execute", verb, data }, trigger: "manual" },
		...overrides,
	};
}

const clockInPrompt: TeamsVehicleUsePrompt = {
	stage: "clock_in",
	workPeriodId: work,
	clockOutEntryId: null,
	vehicles: [
		{ id: van, label: "Van (M-VW 1)" },
		{ id: truck, label: "Truck (M-TR 2)" },
	],
	suggestedVehicleId: van,
	prefillStartKm: 12_000,
	recorded: null,
};

describe("Teams vehicle use card", () => {
	it("asks a clock-in for the vehicle, the assigned one suggested, and the start reading pre-filled", () => {
		const card = teamsVehicleUseCard(clockInPrompt, t);

		expect(inputs(card)).toEqual([
			expect.objectContaining({
				type: "Input.ChoiceSet",
				id: "vehicle",
				value: van,
				choices: [
					{ title: "Van (M-VW 1)", value: van },
					{ title: "Truck (M-TR 2)", value: truck },
					{ title: "Own vehicle", value: "own" },
				],
			}),
			expect.objectContaining({ type: "Input.Number", id: "startKm", value: 12_000 }),
		]);
		expect(action(card, TEAMS_VEHICLE_USE_VERBS.save)).toMatchObject({
			type: "Action.Execute",
			data: { s: "clock_in", w: work, pv: van, pk: 12_000 },
		});
		// Skipping never needs a valid entry.
		expect(action(card, TEAMS_VEHICLE_USE_VERBS.skip)).toMatchObject({
			type: "Action.Execute",
			associatedInputs: "none",
			data: { s: "clock_in", w: work },
		});
	});

	it("asks a clock-out for the end reading of the vehicle recorded with a start reading", () => {
		const card = teamsVehicleUseCard(
			{
				stage: "clock_out",
				workPeriodId: work,
				clockOutEntryId: clockOut,
				vehicles: [],
				suggestedVehicleId: null,
				prefillStartKm: null,
				recorded: { vehicleLabel: "Van (M-VW 1)", startKm: 12_000 },
			},
			t,
		);

		expect(inputs(card)).toEqual([
			expect.objectContaining({ type: "Input.Number", id: "endKm", min: 12_000 }),
		]);
	});

	it("asks a clock-out for the driven distance of a vehicle recorded without a start reading", () => {
		const card = teamsVehicleUseCard(
			{
				stage: "clock_out",
				workPeriodId: work,
				clockOutEntryId: clockOut,
				vehicles: [],
				suggestedVehicleId: null,
				prefillStartKm: null,
				recorded: { vehicleLabel: null, startKm: null },
			},
			t,
		);

		expect(inputs(card)).toEqual([
			expect.objectContaining({ type: "Input.Number", id: "distanceKm" }),
		]);
	});

	it("asks a clock-out of work without a vehicle for vehicle and both readings", () => {
		const card = teamsVehicleUseCard(
			{ ...clockInPrompt, stage: "clock_out", clockOutEntryId: clockOut },
			t,
		);

		expect(inputs(card).map((input) => input.id)).toEqual(["vehicle", "startKm", "endKm"]);
		// Both actions name the clock-out entry the completion is bound to (#807 decision 7).
		expect(action(card, TEAMS_VEHICLE_USE_VERBS.save)).toMatchObject({
			data: { s: "clock_out", w: work, c: clockOut, pv: van, pk: 12_000 },
		});
		expect(action(card, TEAMS_VEHICLE_USE_VERBS.skip)).toMatchObject({
			data: { s: "clock_out", w: work, c: clockOut },
		});
	});

	it("shows the plausibility warnings of what was saved, never controls", () => {
		const card = teamsVehicleUseOutcomeCard("Vehicle use saved.", {
			title: "Please check the vehicle use:",
			lines: ["1,600 km is more than 1,500 km in one work period."],
		});

		expect(card.body).toEqual([
			{ type: "TextBlock", text: "Vehicle use saved.", wrap: true },
			expect.objectContaining({ text: "Please check the vehicle use:", color: "warning" }),
			expect.objectContaining({
				text: "1,600 km is more than 1,500 km in one work period.",
				color: "warning",
			}),
		]);
		expect(card).not.toHaveProperty("actions");
		expect(
			teamsVehicleUseOutcomeCard("Vehicle use saved.", { title: "x", lines: [] }).body,
		).toEqual([{ type: "TextBlock", text: "Vehicle use saved.", wrap: true }]);
	});

	it("names markdown in vehicle names as text", () => {
		const card = teamsVehicleUseCard(
			{
				stage: "clock_out",
				workPeriodId: work,
				clockOutEntryId: clockOut,
				vehicles: [],
				suggestedVehicleId: null,
				prefillStartKm: null,
				recorded: { vehicleLabel: "Van *1* [x](y)", startKm: 5 },
			},
			t,
		);

		expect(JSON.stringify(card.body)).toContain("Van \\\\*1\\\\* \\\\[x\\\\](y)");
	});
});

describe("Teams vehicle use card presses", () => {
	it("ignores invokes that are not vehicle use", () => {
		expect(parseTeamsVehicleUseInvoke({ type: "message", value: {} })).toEqual({ kind: "none" });
		expect(parseTeamsVehicleUseInvoke(invoke("z8.approval.approve", { b: work }))).toEqual({
			kind: "none",
		});
	});

	it("reads a saved clock-in's vehicle and start reading as Teams sends them", () => {
		expect(
			parseTeamsVehicleUseInvoke(
				invoke(TEAMS_VEHICLE_USE_VERBS.save, {
					s: "clock_in",
					w: work,
					pv: van,
					pk: 12_000,
					vehicle: van.toUpperCase(),
					startKm: " 12010 ",
				}),
			),
		).toEqual({
			kind: "save",
			stage: "clock_in",
			workPeriodId: work,
			supplied: { vehicle: { kind: "organization", vehicleId: van }, startKm: 12_010 },
		});
		expect(
			parseTeamsVehicleUseInvoke(
				invoke(TEAMS_VEHICLE_USE_VERBS.save, {
					s: "clock_in",
					w: work,
					vehicle: "own",
					startKm: "",
				}),
			),
		).toEqual({
			kind: "save",
			stage: "clock_in",
			workPeriodId: work,
			supplied: { vehicle: { kind: "own" } },
		});
	});

	it("drops the pre-filled start reading when another vehicle is picked", () => {
		expect(
			parseTeamsVehicleUseInvoke(
				invoke(TEAMS_VEHICLE_USE_VERBS.save, {
					s: "clock_in",
					w: work,
					pv: van,
					pk: 12_000,
					vehicle: truck,
					startKm: "12000",
				}),
			),
		).toEqual({
			kind: "save",
			stage: "clock_in",
			workPeriodId: work,
			supplied: { vehicle: { kind: "organization", vehicleId: truck } },
		});
	});

	it("reads a saved clock-out's end reading or distance", () => {
		expect(
			parseTeamsVehicleUseInvoke(
				invoke(TEAMS_VEHICLE_USE_VERBS.save, {
					s: "clock_out",
					w: work,
					c: clockOut.toUpperCase(),
					endKm: 12_085,
				}),
			),
		).toEqual({
			kind: "save",
			stage: "clock_out",
			workPeriodId: work,
			clockOutId: clockOut,
			supplied: { endKm: 12_085 },
		});
		expect(
			parseTeamsVehicleUseInvoke(
				invoke(TEAMS_VEHICLE_USE_VERBS.save, {
					s: "clock_out",
					w: work,
					c: clockOut,
					distanceKm: "42",
				}),
			),
		).toEqual({
			kind: "save",
			stage: "clock_out",
			workPeriodId: work,
			clockOutId: clockOut,
			supplied: { distanceKm: 42 },
		});
	});

	it("refuses a clock-out press that names no clock-out entry", () => {
		expect(
			parseTeamsVehicleUseInvoke(
				invoke(TEAMS_VEHICLE_USE_VERBS.save, { s: "clock_out", w: work, endKm: 12_085 }),
			),
		).toEqual({ kind: "invalid" });
		expect(
			parseTeamsVehicleUseInvoke(
				invoke(TEAMS_VEHICLE_USE_VERBS.save, { s: "clock_out", w: work, c: "x", endKm: 1 }),
			),
		).toEqual({ kind: "invalid" });
	});

	it("reads a skip", () => {
		expect(
			parseTeamsVehicleUseInvoke(
				invoke(TEAMS_VEHICLE_USE_VERBS.skip, { s: "clock_out", w: work, c: clockOut }),
			),
		).toEqual({ kind: "skip", stage: "clock_out", workPeriodId: work, clockOutId: clockOut });
	});

	it("rejects entries that cannot be read, so the card stays for a fix", () => {
		const save = (data: Record<string, unknown>) =>
			parseTeamsVehicleUseInvoke(invoke(TEAMS_VEHICLE_USE_VERBS.save, { w: work, ...data }));

		expect(save({ s: "clock_in", vehicle: van, startKm: "12.5" })).toEqual({
			kind: "rejected",
			code: "invalid_reading",
		});
		expect(save({ s: "clock_in", vehicle: "" })).toEqual({
			kind: "rejected",
			code: "vehicle_required",
		});
		expect(save({ s: "clock_out", c: clockOut })).toEqual({
			kind: "rejected",
			code: "reading_required",
		});
	});

	it("refuses presses outside the supported callback profile", () => {
		expect(
			parseTeamsVehicleUseInvoke(
				invoke(TEAMS_VEHICLE_USE_VERBS.save, { s: "clock_in", w: work }, { name: "task/fetch" }),
			),
		).toEqual({ kind: "invalid" });
		expect(
			parseTeamsVehicleUseInvoke(invoke(TEAMS_VEHICLE_USE_VERBS.skip, { s: "break", w: work })),
		).toEqual({ kind: "invalid" });
		expect(
			parseTeamsVehicleUseInvoke(invoke(TEAMS_VEHICLE_USE_VERBS.skip, { s: "clock_in", w: "x" })),
		).toEqual({ kind: "invalid" });
		expect(
			parseTeamsVehicleUseInvoke({
				...invoke(TEAMS_VEHICLE_USE_VERBS.save, { s: "clock_in", w: work, vehicle: "own" }),
				value: {
					action: {
						type: "Action.Execute",
						verb: TEAMS_VEHICLE_USE_VERBS.save,
						data: { s: "clock_in", w: work, vehicle: "own" },
					},
					trigger: "automatic",
				},
			}),
		).toEqual({ kind: "invalid" });
	});
});
