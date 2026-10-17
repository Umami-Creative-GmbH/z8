/**
 * PostgreSQL contract: pnpm test:integration (from apps/webapp).
 *
 * Raw `sql` bucket selections come back from node-postgres as timestamp strings
 * such as `2020-03-08 00:00:00` and `2020-03-08 00:00:00+00`, not ISO strings
 * or Dates. The unit tests feed ISO strings, so only a real database proves that
 * every metric row still lands in its chart bucket (#1325).
 */
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { organization, session, user } from "@/db/auth-schema";
import { billingSeatAudit, subscription } from "@/db/schema";
import { getPlatformAnalyticsData } from "./service";
import type { PlatformAnalyticsPoint } from "./types";

// Far before any other suite's rows, so the platform-wide counts are exact.
const NOW = new Date("2020-03-10T12:00:00.000Z");
const runId = randomUUID().slice(0, 8);
const organizationId = `t1325-org-${runId}`;
const userIds = ["a", "b", "c", "d"].map((key) => `t1325-${key}-${runId}`);

const SIGNUPS = [
	"2020-03-04T10:00:00.000Z",
	"2020-03-08T10:00:00.000Z",
	"2020-03-08T23:30:00.000Z",
	"2020-03-10T09:00:00.000Z",
];

beforeAll(async () => {
	await db.insert(user).values(
		userIds.map((id, index) => ({
			id,
			name: `T1325 ${index}`,
			email: `${id}@t1325.test`,
			createdAt: new Date(SIGNUPS[index]!),
			updatedAt: new Date(SIGNUPS[index]!),
		})),
	);
	await db
		.insert(session)
		.values([
			sessionRow(userIds[1]!, "2020-03-08T11:00:00.000Z"),
			sessionRow(userIds[1]!, "2020-03-08T12:00:00.000Z"),
			sessionRow(userIds[2]!, "2020-03-08T23:45:00.000Z"),
		]);
	await db.insert(organization).values({
		id: organizationId,
		name: "T1325",
		slug: organizationId,
		createdAt: new Date("2020-03-07T08:00:00.000Z"),
	});
	await db.insert(subscription).values({
		organizationId,
		status: "active",
		billingInterval: "month",
		currentSeats: 8,
		createdAt: new Date("2020-03-07T15:00:00.000Z"),
	});
	await db.insert(billingSeatAudit).values([
		{
			organizationId,
			action: "member_added",
			previousSeats: 0,
			newSeats: 5,
			createdAt: new Date("2020-03-07T15:00:00.000Z"),
		},
		{
			organizationId,
			action: "member_added",
			previousSeats: 5,
			newSeats: 8,
			createdAt: new Date("2020-03-09T10:00:00.000Z"),
		},
	]);
});

afterEach(() => {
	vi.useRealTimers();
});

afterAll(async () => {
	await db.delete(organization).where(inArray(organization.id, [organizationId]));
	await db.delete(user).where(inArray(user.id, userIds));
});

describe("getPlatformAnalyticsData against PostgreSQL", () => {
	it("fills daily count and billing buckets from database timestamps", async () => {
		const series = await loadSeries({ range: "7d", bucket: "day" });

		expect(series.map((point) => point.bucketKey)).toEqual([
			"2020-03-04",
			"2020-03-05",
			"2020-03-06",
			"2020-03-07",
			"2020-03-08",
			"2020-03-09",
			"2020-03-10",
		]);
		expect(pick(series, "signups")).toEqual([1, 0, 0, 0, 2, 0, 1]);
		expect(pick(series, "sessions")).toEqual([0, 0, 0, 0, 3, 0, 0]);
		expect(pick(series, "activeUsers")).toEqual([0, 0, 0, 0, 2, 0, 0]);
		expect(pick(series, "organizations")).toEqual([0, 0, 0, 1, 0, 0, 0]);
		expect(pick(series, "seats")).toEqual([0, 0, 0, 5, 5, 8, 8]);
		expect(pick(series, "mrr")).toEqual([0, 0, 0, 20, 20, 32, 32]);
	});

	it("fills weekly buckets binned from the range start", async () => {
		const series = await loadSeries({ range: "90d", bucket: "week" });
		const byKey = new Map(series.map((point) => [point.bucketKey, point]));

		expect(byKey.get("2020-02-27")).toMatchObject({ signups: 1, seats: 0, mrr: 0 });
		expect(byKey.get("2020-03-05")).toMatchObject({
			signups: 3,
			sessions: 3,
			activeUsers: 2,
			organizations: 1,
			seats: 8,
			mrr: 32,
		});
	});

	it("fills monthly buckets", async () => {
		const series = await loadSeries({ range: "12m", bucket: "month" });

		expect(series.at(-1)).toMatchObject({
			bucketKey: "2020-03",
			signups: 4,
			sessions: 3,
			activeUsers: 2,
			organizations: 1,
			seats: 8,
			mrr: 32,
		});
		expect(series.at(-2)).toMatchObject({ bucketKey: "2020-02", signups: 0, seats: 0 });
	});
});

async function loadSeries(params: { range: string; bucket: string }) {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW);
	const data = await getPlatformAnalyticsData(params, true, { includeTimeRecords: false });
	vi.useRealTimers();

	return data.series;
}

function pick(series: PlatformAnalyticsPoint[], metric: keyof PlatformAnalyticsPoint) {
	return series.map((point) => point[metric]);
}

function sessionRow(userId: string, createdAt: string) {
	const id = randomUUID();

	return {
		id,
		token: `t1325-${id}`,
		userId,
		createdAt: new Date(createdAt),
		updatedAt: new Date(createdAt),
		expiresAt: new Date("2020-04-10T00:00:00.000Z"),
	};
}
