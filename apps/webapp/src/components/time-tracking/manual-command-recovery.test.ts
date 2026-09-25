/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from "vitest";
import type { ManualTimeEntryCommand } from "@/lib/time-tracking/manual-command";
import {
	beginManualAttempt,
	canDiscardManualRecovery,
	clearManualRecoveries,
	discardManualRecovery,
	freezeManualCommand,
	frozenManualCommand,
	listManualRecoveries,
	lookupVerdict,
	type ManualRecoveryScope,
	type RecoveryStorage,
	settleManualAttempt,
	settleManualLookup,
	submissionVerdict,
	tabRecoveryStorage,
} from "./manual-command-recovery";

const scope: ManualRecoveryScope = {
	userId: "user-1",
	organizationId: "org-1",
	targetEmployeeId: "employee-1",
};

function command(overrides: Partial<ManualTimeEntryCommand> = {}): ManualTimeEntryCommand {
	return {
		version: 2,
		submissionId: "10000000-0000-4000-8000-000000000310",
		targetEmployeeId: "employee-1",
		date: "2026-09-01",
		clockIn: { time: "08:00", occurrence: null, displayedOffsetMinutes: 120 },
		clockOut: { time: "12:30", occurrence: null, displayedOffsetMinutes: 120 },
		zone: { basis: "target", timezone: "Europe/Berlin" },
		browserTimezone: "Europe/Berlin",
		reason: "Forgot to clock in",
		projectId: null,
		workCategoryId: null,
		...overrides,
	};
}

function memoryStorage(): RecoveryStorage & { entries: Map<string, string> } {
	const entries = new Map<string, string>();
	return {
		entries,
		read: (key) => entries.get(key) ?? null,
		write: (key, value) => void entries.set(key, value),
		remove: (key) => void entries.delete(key),
		keys: () => [...entries.keys()],
	};
}

const FROZEN_AT = "2026-09-25T10:00:00Z";

describe("freezing and listing", () => {
	it("freezes the exact command and lists it only for the same user, organization and target", () => {
		const storage = memoryStorage();
		const frozen = command();
		const begun = beginManualAttempt(storage, freezeManualCommand(scope, frozen, FROZEN_AT));

		expect(begun).toMatchObject({
			status: "uncertain",
			attempts: 1,
			submissionId: frozen.submissionId,
		});
		expect(listManualRecoveries(storage, scope)).toEqual([begun]);
		expect(frozenManualCommand(begun)).toEqual(frozen);
		for (const other of [
			{ ...scope, userId: "user-2" },
			{ ...scope, organizationId: "org-2" },
			{ ...scope, targetEmployeeId: "employee-2" },
		]) {
			expect(listManualRecoveries(storage, other)).toEqual([]);
		}
	});

	it("never changes the frozen bytes when the caller's command object changes later", () => {
		const storage = memoryStorage();
		const frozen = command();
		const begun = beginManualAttempt(storage, freezeManualCommand(scope, frozen, FROZEN_AT));
		frozen.reason = "Edited afterwards";
		frozen.clockIn.time = "09:00";

		const [listed] = listManualRecoveries(storage, scope);
		if (!listed) throw new Error("The frozen command must be listed");
		expect(listed.command).toBe(begun.command);
		expect(frozenManualCommand(listed)).toMatchObject({
			reason: "Forgot to clock in",
			clockIn: { time: "08:00" },
		});
	});

	it("keeps an unresolved command when a new identity is frozen for the same target", () => {
		const storage = memoryStorage();
		const first = beginManualAttempt(storage, freezeManualCommand(scope, command(), FROZEN_AT));
		const second = beginManualAttempt(
			storage,
			freezeManualCommand(
				scope,
				command({ submissionId: "20000000-0000-4000-8000-000000000310", reason: "Edited" }),
				"2026-09-25T10:05:00Z",
			),
		);

		expect(listManualRecoveries(storage, scope)).toEqual([first, second]);
	});

	it("refuses to freeze a command for a different target than its scope", () => {
		expect(() =>
			freezeManualCommand(scope, command({ targetEmployeeId: "employee-2" }), FROZEN_AT),
		).toThrow();
	});

	it("ignores malformed or foreign entries without deleting them", () => {
		const storage = memoryStorage();
		const begun = beginManualAttempt(storage, freezeManualCommand(scope, command(), FROZEN_AT));
		const [key] = storage.keys();
		const malformedKey = `${key}-broken`;
		storage.write(malformedKey, "{not json");
		const tampered = `${key?.replace(scope.userId, "user-2")}`;
		storage.write(
			tampered,
			JSON.stringify({ ...begun, scope: { ...scope, userId: "user-2" }, version: 99 }),
		);

		expect(listManualRecoveries(storage, scope)).toEqual([begun]);
		expect(storage.read(malformedKey)).toBe("{not json");
	});

	it("clears every recovery in the tab, as sign-out does", () => {
		const storage = memoryStorage();
		beginManualAttempt(storage, freezeManualCommand(scope, command(), FROZEN_AT));
		beginManualAttempt(
			storage,
			freezeManualCommand({ ...scope, organizationId: "org-2" }, command(), FROZEN_AT),
		);
		storage.write("unrelated", "kept");

		clearManualRecoveries(storage);

		expect(storage.keys()).toEqual(["unrelated"]);
	});
});

describe("classifying a submission response", () => {
	it("separates committed, conclusive noncommitment, conflicts, pre-identity refusals and uncertainty", () => {
		expect(
			submissionVerdict({ success: true, data: { workPeriodId: "p", requiresApproval: false } }),
		).toEqual({
			kind: "committed",
		});
		expect(
			submissionVerdict({
				success: false,
				error: "overlap",
				code: "occupancy_conflict",
				rejection: { reason: "occupancy_conflict", occupants: [] },
			}),
		).toEqual({ kind: "not_committed", code: "occupancy_conflict" });
		expect(
			submissionVerdict({ success: false, error: "x", code: "manual_entry_not_adopted" }),
		).toEqual({ kind: "not_committed", code: "manual_entry_not_adopted" });
		expect(submissionVerdict({ success: false, error: "x", code: "approval_unroutable" })).toEqual({
			kind: "not_committed",
			code: "approval_unroutable",
		});
		expect(
			submissionVerdict({ success: false, error: "x", code: "manual_entry_collision" }),
		).toEqual({
			kind: "conflict",
		});
		// Refused before the submission identity was reached: says nothing about earlier attempts.
		for (const code of [
			"context_mismatch",
			"target_not_authorized",
			"not_authenticated",
			"employee_not_found",
		]) {
			expect(submissionVerdict({ success: false, error: "x", code })).toEqual({
				kind: "refused",
				code,
			});
		}
		expect(
			submissionVerdict({
				success: false,
				error: "invalid",
				code: "invalid_command",
				rejection: { reason: "invalid_command", field: "date" },
			}),
		).toEqual({ kind: "refused", code: "invalid_command" });
		expect(
			submissionVerdict({ success: false, error: "billing_required", code: "trial_expired" }),
		).toEqual({ kind: "refused", code: "billing_required" });
		// A generic failure may have committed before the failure surfaced.
		expect(submissionVerdict({ success: false, error: "Failed to create time entry." })).toEqual({
			kind: "uncertain",
		});
		expect(submissionVerdict({ success: false, error: "x", code: "something_new" })).toEqual({
			kind: "uncertain",
		});
		expect(submissionVerdict(undefined)).toEqual({ kind: "uncertain" });
	});

	it("keeps lookup answers distinct", () => {
		expect(
			lookupVerdict({
				status: "committed",
				data: { workPeriodId: "p", requiresApproval: true, currentApprovalStatus: "approved" },
			}),
		).toEqual({ kind: "committed" });
		expect(lookupVerdict({ status: "not_committed" })).toEqual({
			kind: "not_committed",
			code: null,
		});
		expect(lookupVerdict({ status: "conflict" })).toEqual({ kind: "conflict" });
		expect(lookupVerdict({ status: "unsupported" })).toEqual({ kind: "unsupported" });
		expect(lookupVerdict({ status: "refused", error: "x", code: "context_mismatch" })).toEqual({
			kind: "refused",
			code: "context_mismatch",
		});
		expect(lookupVerdict({ status: "failed", error: "x" })).toEqual({ kind: "unanswered" });
		expect(lookupVerdict(undefined)).toEqual({ kind: "unanswered" });
	});
});

describe("settling attempts", () => {
	let storage: ReturnType<typeof memoryStorage>;
	beforeEach(() => {
		storage = memoryStorage();
	});

	function firstAttempt() {
		return beginManualAttempt(storage, freezeManualCommand(scope, command(), FROZEN_AT));
	}

	it("removes the record once the command committed", () => {
		const begun = firstAttempt();
		expect(
			settleManualAttempt(storage, { previous: null, begun, verdict: { kind: "committed" } }),
		).toBeNull();
		expect(listManualRecoveries(storage, scope)).toEqual([]);
	});

	it("keeps an uncertain first attempt for exact retry", () => {
		const begun = firstAttempt();
		expect(
			settleManualAttempt(storage, { previous: null, begun, verdict: { kind: "uncertain" } }),
		).toEqual(begun);
		expect(listManualRecoveries(storage, scope)).toEqual([begun]);
	});

	it("drops a first form attempt that was answered definitively without a commit", () => {
		for (const verdict of [
			{ kind: "not_committed", code: "occupancy_conflict" },
			{ kind: "refused", code: "billing_required" },
		] as const) {
			const begun = firstAttempt();
			expect(settleManualAttempt(storage, { previous: null, begun, verdict })).toBeNull();
			expect(listManualRecoveries(storage, scope)).toEqual([]);
		}
	});

	it("keeps an uncertain command uncertain when a retry is refused before the identity", () => {
		const uncertain = firstAttempt();
		const retry = beginManualAttempt(storage, uncertain);
		const settled = settleManualAttempt(storage, {
			previous: uncertain,
			begun: retry,
			verdict: { kind: "refused", code: "context_mismatch" },
		});

		expect(settled).toMatchObject({ status: "uncertain", attempts: 2, code: "context_mismatch" });
		expect(listManualRecoveries(storage, scope)).toEqual([settled]);
	});

	it("records conclusive noncommitment of a retried command for review instead of dropping it", () => {
		const uncertain = firstAttempt();
		const retry = beginManualAttempt(storage, uncertain);
		const settled = settleManualAttempt(storage, {
			previous: uncertain,
			begun: retry,
			verdict: { kind: "not_committed", code: "holiday_blocked" },
		});

		expect(settled).toMatchObject({ status: "not_committed", code: "holiday_blocked" });
		expect(settled && canDiscardManualRecovery(settled)).toBe(true);
	});

	it("marks an identity collision as a conflict to inspect", () => {
		const begun = firstAttempt();
		expect(
			settleManualAttempt(storage, { previous: null, begun, verdict: { kind: "conflict" } }),
		).toMatchObject({ status: "conflict", code: "manual_entry_collision" });
	});

	it("resolves lookups without changing the frozen command", () => {
		const begun = firstAttempt();
		const absent = settleManualLookup(storage, begun, { kind: "not_committed", code: null });
		expect(absent).toMatchObject({ status: "not_committed", command: begun.command, attempts: 1 });
		const unsupported = settleManualLookup(storage, begun, { kind: "unsupported" });
		expect(unsupported).toMatchObject({ status: "unsupported", command: begun.command });
		expect(settleManualLookup(storage, begun, { kind: "unanswered" })).toEqual(begun);
		expect(
			settleManualLookup(storage, begun, { kind: "refused", code: "context_mismatch" }),
		).toMatchObject({ status: "uncertain", code: "context_mismatch" });
		expect(settleManualLookup(storage, begun, { kind: "committed" })).toBeNull();
		expect(listManualRecoveries(storage, scope)).toEqual([]);
	});

	it("never discards a command that may be saved", () => {
		const begun = firstAttempt();
		expect(canDiscardManualRecovery(begun)).toBe(false);
		expect(canDiscardManualRecovery({ ...begun, status: "unsupported" })).toBe(false);
		expect(() => discardManualRecovery(storage, begun)).toThrow();
		expect(listManualRecoveries(storage, scope)).toEqual([begun]);

		const conflict = settleManualLookup(storage, begun, { kind: "conflict" });
		if (!conflict) throw new Error("A conflict stays recorded");
		discardManualRecovery(storage, conflict);
		expect(listManualRecoveries(storage, scope)).toEqual([]);
	});
});

describe("tab storage", () => {
	beforeEach(() => {
		window.sessionStorage.clear();
	});

	it("persists in the tab's session storage so a reload keeps the command", () => {
		const begun = beginManualAttempt(
			tabRecoveryStorage(),
			freezeManualCommand(scope, command(), FROZEN_AT),
		);

		// A fresh storage handle, as after a reload of the same tab.
		expect(listManualRecoveries(tabRecoveryStorage(), scope)).toEqual([begun]);
		expect(window.sessionStorage.length).toBe(1);
		expect(window.localStorage.length).toBe(0);
	});

	it("falls back to page memory when session storage refuses the write", () => {
		const original = Storage.prototype.setItem;
		Storage.prototype.setItem = () => {
			throw new DOMException("quota", "QuotaExceededError");
		};
		try {
			const begun = beginManualAttempt(
				tabRecoveryStorage(),
				freezeManualCommand(scope, command(), FROZEN_AT),
			);
			expect(listManualRecoveries(tabRecoveryStorage(), scope)).toEqual([begun]);
			clearManualRecoveries(tabRecoveryStorage());
			expect(listManualRecoveries(tabRecoveryStorage(), scope)).toEqual([]);
		} finally {
			Storage.prototype.setItem = original;
		}
	});
});
