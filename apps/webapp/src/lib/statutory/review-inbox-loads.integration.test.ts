/**
 * #1994: one inbox load evaluates each monitor once (real PostgreSQL). The Command Center reloads
 * the inbox every two minutes, so the review lists and the monitor findings share one evaluation
 * per monitor and one request-scoped reader, and the counts-only load skips the name lookups.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, pool } from "@/db";
import { integrationAdminPool } from "@/test/integration-database";
import { statutoryFixture } from "@/test/statutory-fixtures";
import {
	STATUTORY_DOMAINS_NOW as now,
	statutoryDomainsFixture,
} from "./__tests__/statutory-domains-fixture";
import { evaluateMinijobEarnings } from "./minijob/evaluate-minijob";
import { loadMinijobExceedanceReviews } from "./minijob/minijob-reviews";
import { loadStatutoryReviewInbox } from "./review-inbox";
import { jarbschgScheduleContributor } from "./youth/jarbschg-contributor";
import { listOpenYouthSectorExceptions } from "./youth/sector-exception-review";

vi.mock("./minijob/evaluate-minijob", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./minijob/evaluate-minijob")>();
	return { ...actual, evaluateMinijobEarnings: vi.fn(actual.evaluateMinijobEarnings) };
});

const timezone = "Europe/Berlin";

/** Every statement the app pool runs while `run` runs, as SQL text with its parameters. */
async function statementsOf<T>(
	run: () => Promise<T>,
): Promise<{ result: T; statements: string[] }> {
	const statements: string[] = [];
	const query = pool.query.bind(pool);
	const spy = vi.spyOn(pool, "query").mockImplementation(((...args: Parameters<typeof query>) => {
		const [text, values] = args as unknown as [
			string | { text: string; values?: unknown[] },
			unknown[]?,
		];
		statements.push(
			typeof text === "string"
				? JSON.stringify([text, values ?? []])
				: JSON.stringify([text.text, text.values ?? values ?? []]),
		);
		return query(...args);
	}) as typeof pool.query);
	try {
		return { result: await run(), statements };
	} finally {
		spy.mockRestore();
	}
}

describe("statutory review inbox loads (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 180_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const fx = statutoryFixture(admin, "t1994-loads");
	const domains = statutoryDomainsFixture(admin, fx);

	beforeEach(async () => {
		await fx.cleanup();
		domains.reset();
		vi.mocked(evaluateMinijobEarnings).mockClear();
	});
	afterAll(fx.cleanup);

	it("evaluates Minijob and JArbSchG once and runs no read twice per inbox load", async () => {
		const seed = await domains.seed("a");
		const organizationId = seed.org.id;
		const youth = vi.spyOn(jarbschgScheduleContributor, "evaluate");

		const { result: inbox, statements } = await statementsOf(() =>
			loadStatutoryReviewInbox(db, { organizationId, now, includeResolved: true }),
		);

		expect(vi.mocked(evaluateMinijobEarnings)).toHaveBeenCalledTimes(1);
		expect(youth).toHaveBeenCalledTimes(1);
		youth.mockRestore();
		const repeated = statements.filter(
			(statement, index) => statements.indexOf(statement) !== index,
		);
		expect(repeated).toEqual([]);

		// The same items the domains' own review lists show.
		const minijob = await loadMinijobExceedanceReviews(db, {
			organizationId,
			now,
			includeAcknowledged: true,
		});
		expect(
			inbox.items
				.filter((item) => item.source === "review" && item.reviewDomain === "minijob")
				.map((item) => [item.id, item.employeeName, item.severity, item.acknowledgementStatus]),
		).toEqual(
			minijob.map((review) => [
				review.id,
				review.employeeName,
				review.severity,
				review.acknowledgement.status,
			]),
		);
		const sector = await listOpenYouthSectorExceptions(db, {
			organizationId,
			timezone,
			now,
			includeAcknowledged: true,
		});
		expect(sector.length).toBeGreaterThan(0);
		expect(
			inbox.items
				.filter((item) => item.source === "review" && item.reviewDomain === "youth_apprentice")
				.map((item) => [item.id, item.employeeName, item.kind, item.acknowledgementStatus])
				.sort(),
		).toEqual(
			sector
				.map((finding) => [
					finding.findingId,
					finding.employeeName,
					finding.findingKind,
					finding.acknowledgementStatus,
				])
				.sort(),
		);
	});

	it("counts the same without reading any employee's name", async () => {
		const seed = await domains.seed("a");
		const organizationId = seed.org.id;

		const full = await loadStatutoryReviewInbox(db, { organizationId, now });
		const { result: counts, statements } = await statementsOf(() =>
			loadStatutoryReviewInbox(db, { organizationId, now, countsOnly: true }),
		);

		expect(counts.domains).toEqual(full.domains);
		expect(counts.items.map((item) => item.id).sort()).toEqual(
			full.items.map((item) => item.id).sort(),
		);
		expect(counts.items.every((item) => item.employeeName === "")).toBe(true);
		// Names come from the user's first and last name: no statement reads them.
		expect(statements.filter((statement) => statement.includes('"first_name"'))).toEqual([]);
	});
});
