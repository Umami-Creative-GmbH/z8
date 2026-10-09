import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ClockRecoveryNotice } from "../src/components/ClockRecoveryNotice";
import { LocaleProvider } from "../src/lib/i18n";
import type { ClockJournal, SavedClockCommand } from "../src/types";

afterEach(cleanup);

/** A queued clock-out the server refused with the v2 422 body (#875). */
function refused(response: Record<string, unknown>): SavedClockCommand {
	return {
		operationId: "9f2a6c1e-5d7b-4c3a-b1e8-2f0d4a6b8c9e",
		kind: "clock_out",
		occurredAt: "2026-10-09T16:00:00.000Z",
		timezone: "Europe/Berlin",
		state: "rejected",
		attempts: 1,
		capturedAtMs: 0,
		dependsOn: null,
		failure: {
			class: "rejected",
			code: "attribution_not_allowed",
			httpStatus: 422,
			response: {
				outcome: "rejected",
				operationId: "9f2a6c1e-5d7b-4c3a-b1e8-2f0d4a6b8c9e",
				code: "attribution_not_allowed",
				...response,
			},
			atMs: 0,
		},
		waitingFor: null,
		archivable: true,
		command: "{}",
		receipt: null,
	};
}

function journal(command: SavedClockCommand): ClockJournal {
	return {
		onBreak: false,
		signInRequired: false,
		legacy: {
			total: 0,
			malformed: 0,
			exhausted: 0,
			possiblePartialBreaks: 0,
			breaksWithAcknowledgedClose: 0,
		},
		serverReachable: true,
		commandsEnabled: true,
		breaksEnabled: true,
		commands: [command],
		otherContexts: 0,
		projection: null,
	};
}

function show(command: SavedClockCommand, language: "en" | "de" = "en") {
	render(
		<LocaleProvider language={language}>
			<ClockRecoveryNotice
				journal={journal(command)}
				journalError={false}
				actionError={null}
				savedCommandError={null}
				needsStatusRefresh={false}
				onRefresh={() => {}}
				onRetry={() => {}}
				onArchive={() => {}}
				isUpdating={false}
			/>
		</LocaleProvider>,
	);
}

describe("attribution refusals of saved clock-outs", () => {
	it.each([
		["task_done", "The chosen task was marked done."],
		["task_other_project", "The chosen task belongs to another project."],
		["task_not_found", "The chosen task no longer exists."],
		["project_not_bookable", "The chosen project is not open for booking."],
	])("shows why the task was refused (%s)", (reason, message) => {
		show(refused({ field: "taskId", reason }));
		expect(screen.getByText(message)).toBeDefined();
		expect(screen.getByText("attribution_not_allowed")).toBeDefined();
	});

	it("explains an unknown task reason without guessing", () => {
		show(refused({ field: "taskId", reason: "something_new" }));
		expect(screen.getByText("The chosen task is not available.")).toBeDefined();
	});

	it("explains project and work category refusals the same way", () => {
		show(refused({ field: "projectId" }));
		expect(
			screen.getByText("The chosen project is not open for booking."),
		).toBeDefined();
		cleanup();
		show(refused({ field: "workCategoryId" }));
		expect(
			screen.getByText("The chosen work category is not available."),
		).toBeDefined();
	});

	it("explains the refusal in German", () => {
		show(refused({ field: "taskId", reason: "task_done" }), "de");
		expect(
			screen.getByText("Die gewählte Aufgabe wurde als erledigt markiert."),
		).toBeDefined();
	});
});
