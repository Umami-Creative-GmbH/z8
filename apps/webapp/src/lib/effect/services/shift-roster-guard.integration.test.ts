/**
 * PostgreSQL contract (#1438): saving a shift never newly assigns a former
 * employee. Editing a shift that keeps its assignee still saves, and so does
 * opening the shift.
 */
import { Effect, Layer } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { shiftStoredDate } from "@/lib/scheduling/shift-date";
import {
	createShiftDatabaseFixture,
	SHIFT_DAY,
	type ShiftDatabaseFixture,
	type ShiftTestOrganization,
} from "@/lib/scheduling/testing/shift-database.test.fixture";
import { DatabaseServiceLive } from "./database.service";
import { ShiftService, ShiftServiceLive } from "./shift.service";

const layer = ShiftServiceLive.pipe(Layer.provide(DatabaseServiceLive));

describe("shift assignment and the current roster (#1438)", () => {
	let fixture: ShiftDatabaseFixture;
	let org: ShiftTestOrganization;

	beforeAll(async () => {
		fixture = await createShiftDatabaseFixture();
		org = await fixture.organization("Europe/Berlin");
	});

	afterAll(async () => {
		await fixture?.close();
	});

	type Save = { id?: string; employeeId: string | null; notes?: string };

	const upsert = (input: Save) =>
		Effect.gen(function* () {
			const service = yield* ShiftService;
			return yield* service.upsertShift({
				id: input.id,
				organizationId: org.organizationId,
				employeeId: input.employeeId,
				subareaId: org.subareaId,
				date: shiftStoredDate(SHIFT_DAY, org.timezone),
				timezone: org.timezone,
				startTime: "08:00",
				endTime: "16:00",
				notes: input.notes,
				createdBy: org.creator.userId,
			});
		}).pipe(Effect.provide(layer));

	const saved = (input: Save) => Effect.runPromise(upsert(input));

	/** The refusal of a save that must fail. */
	const save = (input: Save) =>
		Effect.runPromise(Effect.flip(upsert(input))).then((error) => ({ ok: false as const, error }));

	it("refuses a former employee and assigns a current one", async () => {
		const former = await fixture.seedEmployee({
			organizationId: org.organizationId,
			isActive: false,
		});
		const current = await fixture.seedEmployee({ organizationId: org.organizationId });

		const refused = await save({ employeeId: former.employeeId });
		expect(refused).toMatchObject({
			ok: false,
			error: { _tag: "ValidationError", field: "employeeId" },
		});

		const assigned = await saved({ employeeId: current.employeeId });
		expect(assigned.shift.employeeId).toBe(current.employeeId);
	});

	it("refuses an employee of another organization", async () => {
		const other = await fixture.organization("UTC");
		const foreigner = await fixture.seedEmployee({ organizationId: other.organizationId });

		expect(await save({ employeeId: foreigner.employeeId })).toMatchObject({ ok: false });
	});

	it("keeps editing a shift whose assignee has left, and refuses reassigning it to them", async () => {
		const leaver = await fixture.seedEmployee({ organizationId: org.organizationId });
		const first = await saved({ employeeId: leaver.employeeId });
		await fixture.pool.query("update employee set is_active = false where id = $1", [
			leaver.employeeId,
		]);

		const edited = await saved({
			id: first.shift.id,
			employeeId: leaver.employeeId,
			notes: "Past shift note",
		});
		expect(edited.shift).toMatchObject({ employeeId: leaver.employeeId, notes: "Past shift note" });

		const opened = await saved({ id: first.shift.id, employeeId: null });
		expect(opened.shift.employeeId).toBeNull();

		expect(await save({ id: first.shift.id, employeeId: leaver.employeeId })).toMatchObject({
			ok: false,
			error: { _tag: "ValidationError" },
		});
	});
});
