import { describe, expect, it } from "vitest";
import { mergeNewestFirst, type QueueEntry, takeQueuePage } from "./finance-queue-paging";

function entry(type: "report" | "legacy_claim", id: string, decidedAt: number | null) {
	return { type, id, decidedAt, item: `${type}:${id}` } satisfies QueueEntry<string>;
}

async function* stream<T>(items: T[], reads: { count: number } = { count: 0 }) {
	for (const item of items) {
		reads.count++;
		yield item;
	}
}

describe("finance queue paging (#753)", () => {
	const reports = [
		entry("report", "r3", 300),
		entry("report", "r2", 200),
		entry("report", "r1", 100),
	];
	const claims = [entry("legacy_claim", "c3", 250), entry("legacy_claim", "c1", 150)];

	it("merges reports and legacy claims newest decision first", async () => {
		const merged: string[] = [];
		for await (const item of mergeNewestFirst([stream(reports), stream(claims)])) merged.push(item);
		expect(merged).toEqual([
			"report:r3",
			"legacy_claim:c3",
			"report:r2",
			"legacy_claim:c1",
			"report:r1",
		]);
	});

	it("orders equal decisions by kind, then by id descending, and undecided ones last", async () => {
		const merged: string[] = [];
		for await (const item of mergeNewestFirst([
			stream([entry("report", "b", 100), entry("report", "a", 100), entry("report", "z", null)]),
			stream([entry("legacy_claim", "c", 100)]),
		])) {
			merged.push(item);
		}
		expect(merged).toEqual(["report:b", "report:a", "legacy_claim:c", "report:z"]);
	});

	it("pages through the merged list without gaps or repeats", async () => {
		const pages: Array<{ items: string[]; hasMore: boolean }> = [];
		for (const offset of [0, 2, 4]) {
			pages.push(
				await takeQueuePage(mergeNewestFirst([stream(reports), stream(claims)]), {
					offset,
					limit: 2,
				}),
			);
		}
		expect(pages).toEqual([
			{ items: ["report:r3", "legacy_claim:c3"], hasMore: true },
			{ items: ["report:r2", "legacy_claim:c1"], hasMore: true },
			{ items: ["report:r1"], hasMore: false },
		]);
	});

	it("reads no further than one entry past the page", async () => {
		const reads = { count: 0 };
		const page = await takeQueuePage(mergeNewestFirst([stream(reports, reads)]), {
			offset: 0,
			limit: 1,
		});
		expect(page).toEqual({ items: ["report:r3"], hasMore: true });
		// The first entry, the one proving there is more, and the merge's look-ahead.
		expect(reads.count).toBeLessThanOrEqual(3);
	});

	it("returns an empty last page past the end", async () => {
		expect(
			await takeQueuePage(mergeNewestFirst([stream(reports)]), { offset: 10, limit: 2 }),
		).toEqual({ items: [], hasMore: false });
	});
});
