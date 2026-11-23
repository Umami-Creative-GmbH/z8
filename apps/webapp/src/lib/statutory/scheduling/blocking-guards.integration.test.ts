/**
 * #1993 review: the publish block's guards (an edit of a published shift, a publication's caused
 * findings) run inside the save transaction with the shift row locked, so they evaluate only the
 * monitors that can block publication, never the whole registry (real PostgreSQL).
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { parsePlainDate, systemClock } from "@/lib/datetime/temporal-core";
import type { StatutoryComplianceFinding } from "@/lib/scheduling/compliance/types";
import { shiftDateRangeBounds } from "@/lib/scheduling/shift-date";
import { integrationAdminPool } from "@/test/integration-database";
import {
	type FixtureEmployee,
	type FixtureOrganization,
	statutoryFixture,
} from "@/test/statutory-fixtures";
import { youthSeed } from "../youth/testing/youth-seed";
import {
	statutoryBlockingScheduleContributors,
	statutoryScheduleContributors,
} from "./contributors";
import {
	findingsBlockingDraftPublication,
	findingsBlockingPublication,
	lockPublicationDrafts,
} from "./publish-blocking";
import { guardPublishedShiftEdit } from "./published-shift-edit";

describe("publish block guards evaluate only blocking monitors (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const fx = statutoryFixture(admin, "t1993bg");
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
		subareaId = await seed.subarea(org, owner);
		await seed.blockJarbschgPublish(org);
		minor = await fx.employee(org, "minor", { birthday: "2011-01-01" });
	});
	afterEach(() => vi.restoreAllMocks());
	afterAll(fx.cleanup);

	const shift = (date: string, status: "draft" | "published") =>
		seed.shift(org, minor, {
			subareaId,
			creatorUserId: owner.userId,
			date,
			startTime: "09:00",
			endTime: "13:00",
			status,
		});

	/** Spies on every registered monitor; returns those the guard ran, in registry order. */
	function spyOnMonitors() {
		const spies = statutoryScheduleContributors.map((contributor) => ({
			contributor,
			spy: vi.spyOn(contributor, "evaluate"),
		}));
		return () =>
			spies.filter(({ spy }) => spy.mock.calls.length > 0).map(({ contributor }) => contributor);
	}

	it("lists the youth and apprentice-release monitors as the blocking ones", () => {
		expect(statutoryBlockingScheduleContributors.map((contributor) => contributor.domain)).toEqual([
			"youth_protection",
			"apprenticeship",
		]);
		for (const contributor of statutoryBlockingScheduleContributors) {
			expect(statutoryScheduleContributors).toContain(contributor);
		}
	});

	it("runs only the blocking monitors when a published shift is edited", async () => {
		const id = await shift("2027-03-02", "published");
		const ran = spyOnMonitors();

		const saved = await guardPublishedShiftEdit(
			db,
			{
				organizationId: org.id,
				timezone: org.timezone,
				shiftId: id,
				published: true,
				employeeId: minor.employeeId,
				date: parsePlainDate("2027-03-02"),
				now: systemClock.nowInstant(),
			},
			async () => "saved",
		);

		expect(saved).toBe("saved");
		expect(ran()).toEqual([...statutoryBlockingScheduleContributors]);
	});

	it("runs only the blocking monitors to tell which findings a publication causes", async () => {
		const published = await shift("2027-03-01", "published");
		await shift("2027-03-02", "draft");
		const blocking: StatutoryComplianceFinding = {
			type: "statutory",
			employeeId: minor.employeeId,
			findingId: "jarbschg_weekly_max:test",
			statutoryKind: "jarbschg_weekly_max",
			domain: "youth_protection",
			severity: "critical",
			subjectKey: `shift:${published}`,
			legalReference: "§ 8 Abs. 1 JArbSchG",
			summary: {},
			acknowledgementStatus: null,
			blocksPublication: true,
		};
		const ran = spyOnMonitors();

		await findingsBlockingPublication(
			db,
			{
				organizationId: org.id,
				timezone: org.timezone,
				window: { start: "2027-03-01", endExclusive: "2027-03-08" },
				now: systemClock.nowInstant(),
			},
			[blocking],
		);

		expect(ran()).toEqual([...statutoryBlockingScheduleContributors]);
	});

	it("runs only the blocking monitors when the publication judges its locked drafts", async () => {
		await shift("2027-03-02", "draft");
		const ran = spyOnMonitors();

		const blocking = await db.transaction(async (tx) => {
			const drafts = await lockPublicationDrafts(
				tx,
				org.id,
				shiftDateRangeBounds("2027-03-01", "2027-03-08", org.timezone),
			);
			expect(drafts).toHaveLength(1);
			return findingsBlockingDraftPublication(
				tx,
				{
					organizationId: org.id,
					timezone: org.timezone,
					window: { start: "2027-03-01", endExclusive: "2027-03-08" },
					now: systemClock.nowInstant(),
				},
				drafts,
			);
		});

		expect(blocking).toEqual([]);
		expect(ran()).toEqual([...statutoryBlockingScheduleContributors]);
	});
});
