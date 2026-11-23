/**
 * #1993: org admins record a JArbSchG statutory sector exception from Reviews & Conflicts (real
 * PostgreSQL). Only night, Saturday, Sunday and holiday findings qualify; the acknowledgement
 * lifts the publication block, and a finding that changed since the admin saw it is refused.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { systemClock } from "@/lib/datetime/temporal-core";
import { evaluateStatutoryScheduleFindings } from "@/lib/statutory/scheduling/evaluate";
import { youthSeed } from "@/lib/statutory/youth/testing/youth-seed";
import { integrationAdminPool } from "@/test/integration-database";
import type { StubCaller } from "@/test/organization-action";
import {
	type FixtureEmployee,
	type FixtureOrganization,
	statutoryFixture,
} from "@/test/statutory-fixtures";

const harness = vi.hoisted(() => ({ caller: null as StubCaller | null }));

vi.mock("@/lib/effect/runtime", async () => {
	const { db } = await import("@/db");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return (await import("@/test/effect-runtime")).runtimeModuleOver(
		organizationActionStubLayer(() => harness.caller, { db }),
	);
});

const { acknowledgeYouthSectorExceptionAction, listYouthSectorExceptionsAction } =
	await import("./youth-sector-exception-actions");

/** Far enough ahead to stay in the review window whatever today is. */
const inDays = (days: number) =>
	systemClock.nowInstant().toZonedDateTimeISO("Europe/Berlin").toPlainDate().add({ days });

describe("youth sector exception actions (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const fx = statutoryFixture(admin, "t1993se");
	const seed = youthSeed(admin);
	let org: FixtureOrganization;
	let owner: FixtureEmployee;
	let minor: FixtureEmployee;
	let subareaId: string;

	beforeEach(async () => {
		await fx.cleanup();
		org = await fx.organization("a");
		owner = await fx.employee(org, "owner", { role: "admin" });
		await fx.membership(org, owner, "owner");
		const birthday = inDays(0).subtract({ years: 16 }).toString();
		minor = await fx.employee(org, "minor", { birthday });
		await fx.membership(org, minor, "member");
		subareaId = await seed.subarea(org, owner);
		harness.caller = {
			userId: owner.userId,
			activeOrganizationId: org.id,
			membershipRole: "owner",
			employee: { id: owner.employeeId, role: "admin", former: false },
		};
	});
	afterAll(fx.cleanup);

	/** A Tuesday at least a week ahead: a weekday, so only night work is flagged. */
	const nextTuesday = () => {
		const day = inDays(7);
		return day.add({ days: (2 - day.dayOfWeek + 7) % 7 });
	};

	const lateShift = (date: string, endTime = "21:00") =>
		seed.shift(org, minor, {
			subareaId,
			creatorUserId: owner.userId,
			date,
			startTime: "17:00",
			endTime,
		});

	const publishBlocks = async (date: string) =>
		(
			await evaluateStatutoryScheduleFindings(db, {
				organizationId: org.id,
				timezone: org.timezone,
				window: { start: date, endExclusive: inDays(60).toString() },
				employeeIds: [minor.employeeId],
				now: systemClock.nowInstant(),
			})
		).filter((finding) => finding.blocksPublication);

	async function openExceptions() {
		const result = await listYouthSectorExceptionsAction();
		if (!result.success) throw new Error(result.error);
		return result.data;
	}

	it("lists qualifying youth findings and lifts the publish block once acknowledged", async () => {
		await seed.blockJarbschgPublish(org);
		const tuesday = nextTuesday().toString();
		const shiftId = await lateShift(tuesday);
		// A hard limit does not qualify: an 11 h day on Wednesday.
		await seed.shift(org, minor, {
			subareaId,
			creatorUserId: owner.userId,
			date: nextTuesday().add({ days: 1 }).toString(),
			startTime: "07:00",
			endTime: "18:00",
		});

		const open = await openExceptions();
		expect(open).toEqual([
			expect.objectContaining({
				employeeId: minor.employeeId,
				findingKind: "jarbschg_night_work",
				subjectKey: `shift:${shiftId}`,
				periodStart: tuesday,
				acknowledgementStatus: "none",
			}),
		]);
		expect(await publishBlocks(tuesday)).toContainEqual(
			expect.objectContaining({ statutoryKind: "jarbschg_night_work" }),
		);

		const [night] = open;
		const acknowledged = await acknowledgeYouthSectorExceptionAction({
			employeeId: night.employeeId,
			findingKind: night.findingKind,
			subjectKey: night.subjectKey,
			periodStart: night.periodStart,
			expectedFingerprint: night.inputFingerprint,
			reason: "Hospitality: § 14 Abs. 2 Nr. 1 JArbSchG allows work until 22:00 at 16+",
		});
		expect(acknowledged).toMatchObject({ success: true });

		expect(await openExceptions()).toEqual([]);
		const stillBlocking = (await publishBlocks(tuesday)).map((finding) => finding.statutoryKind);
		expect(stillBlocking).not.toContain("jarbschg_night_work");
		expect(stillBlocking).toContain("jarbschg_daily_max");
	});

	it("refuses an acknowledgement of figures that changed since the admin saw them", async () => {
		const tuesday = nextTuesday().toString();
		const shiftId = await lateShift(tuesday);
		const [night] = await openExceptions();
		// The shift now runs until 22:00: the admin never saw that.
		await admin.query("update shift set end_time = '22:00' where id = $1", [shiftId]);

		const refused = await acknowledgeYouthSectorExceptionAction({
			employeeId: night.employeeId,
			findingKind: night.findingKind,
			subjectKey: night.subjectKey,
			periodStart: night.periodStart,
			expectedFingerprint: night.inputFingerprint,
			reason: "Hospitality",
		});
		expect(refused).toMatchObject({ success: false, refusal: "statutory_finding_changed" });
		expect(await openExceptions()).toEqual([
			expect.objectContaining({ subjectKey: night.subjectKey, acknowledgementStatus: "none" }),
		]);
	});

	it("refuses findings that are no sector exception, and callers below org admin", async () => {
		const tuesday = nextTuesday().toString();
		await lateShift(tuesday);
		const [night] = await openExceptions();
		expect(
			await acknowledgeYouthSectorExceptionAction({
				employeeId: night.employeeId,
				findingKind: "jarbschg_daily_max",
				subjectKey: night.subjectKey,
				periodStart: night.periodStart,
				expectedFingerprint: night.inputFingerprint,
				reason: "No",
			}),
		).toMatchObject({ success: false });

		harness.caller = {
			userId: minor.userId,
			activeOrganizationId: org.id,
			membershipRole: "member",
			employee: { id: minor.employeeId, role: "employee", former: false },
		};
		expect(await listYouthSectorExceptionsAction()).toMatchObject({ success: false });
		expect(
			await acknowledgeYouthSectorExceptionAction({
				employeeId: night.employeeId,
				findingKind: night.findingKind,
				subjectKey: night.subjectKey,
				periodStart: night.periodStart,
				expectedFingerprint: night.inputFingerprint,
				reason: "Mine",
			}),
		).toMatchObject({ success: false });
	});
});
