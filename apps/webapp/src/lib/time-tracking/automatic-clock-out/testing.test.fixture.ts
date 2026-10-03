// Test fixtures only; production modules must not import this file.
import { randomUUID } from "node:crypto";
import { automaticClockOutExecution, automaticClockOutTask } from "@/db/schema";
import { dateFromInstant, parseInstant } from "@/lib/datetime/temporal-core";
import type { LifecycleDatabaseFixture } from "@/lib/employee-lifecycle/testing/database.test.fixture";
import type { AutoClockOutDecision, AutoClockOutTaskKind } from "./types";

export const NOW = parseInstant("2026-10-25T06:00:00Z");
export function decision(): AutoClockOutDecision {
	return {
		organizationId: "org",
		employeeId: randomUUID(),
		workPeriodId: randomUUID(),
		operationId: randomUUID(),
		provenanceUserId: "creator",
		start: parseInstant("2026-10-24T18:00:00Z"),
		cutoff: NOW,
		timezone: "Europe/Berlin",
		settings: { autoClockOutEnabled: true, maxUninterruptedMinutes: 720, revision: 0 },
	};
}
export async function seedExecution(
	fixture: LifecycleDatabaseFixture,
	kinds: AutoClockOutTaskKind[] = ["plan_notification"],
	payloadPatch: Record<string, unknown> = {},
) {
	const organizationId = await fixture.createOrganization();
	const person = await fixture.seedEmployee({ organizationId });
	const facts = {
		...decision(),
		organizationId,
		employeeId: person.employeeId,
		provenanceUserId: person.userId,
	};
	const clockOutEntryId = randomUUID();
	await fixture.db.insert(automaticClockOutExecution).values({
		id: facts.operationId,
		organizationId,
		employeeId: person.employeeId,
		workPeriodId: facts.workPeriodId,
		startTime: dateFromInstant(facts.start),
		cutoffTime: dateFromInstant(NOW),
		maxUninterruptedMinutes: 720,
		settingsRevision: 0,
		timezone: facts.timezone,
		utcOffsetMinutes: 60,
		recipientUserId: person.userId,
		provenanceUserId: person.userId,
		clockOutEntryId,
		processedAt: dateFromInstant(NOW),
		closurePayload: {
			version: 1,
			reason: "automatic_clock_out",
			organizationId,
			employeeId: person.employeeId,
			actorUserId: person.userId,
			completingActor: { kind: "system", process: "automatic_clock_out" },
			workPeriodId: facts.workPeriodId,
			clockOutEntryId,
			start: facts.start.toString(),
			end: NOW.toString(),
			durationMinutes: 720,
			timezone: facts.timezone,
			projectId: null,
			workCategoryId: null,
			surchargeSnapshot: null,
			balanceRefreshCommitted: false,
			startCapture: {
				timezone: facts.timezone,
				utcOffsetMinutes: 120,
				timezoneSource: "user_setting",
			},
			endCapture: {
				timezone: facts.timezone,
				utcOffsetMinutes: 60,
				timezoneSource: "system_target_user_setting",
			},
			...payloadPatch,
		},
	});
	for (const kind of kinds)
		await fixture.db.insert(automaticClockOutTask).values({
			organizationId,
			employeeId: person.employeeId,
			operationId: facts.operationId,
			kind,
			dedupeKey: `${kind}:${facts.operationId}`,
			payload: { version: 1, operationId: facts.operationId },
			availableAt: dateFromInstant(NOW),
		});
	return { facts, person };
}
