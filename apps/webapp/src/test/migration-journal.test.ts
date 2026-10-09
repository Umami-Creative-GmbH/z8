import { readdir, readFile } from "node:fs/promises";
import { expect, it } from "vitest";

const migrations = new URL("../../drizzle/", import.meta.url);
const journal = JSON.parse(
	await readFile(new URL("meta/_journal.json", migrations), "utf8"),
) as { entries: { idx: number; tag: string; when: number }[] };
// Preserve deployed history; later migrations recover these known omissions.
const historicalRecoveries: Record<string, string> = {
	"0021_sick_detail": "0051_sick_detail_recovery",
	"0027_employee_work_balance": "0029_employee_work_balance_recovery",
	"0051_daily_digest_delivery": "0060_approval_workflow_recovery",
};

it("every SQL migration is journaled or has an explicit later recovery", async () => {
	const files = (await readdir(migrations)).filter((f) => f.endsWith(".sql"));
	const tags = new Set(journal.entries.map((e) => e.tag));
	expect(new Set(journal.entries.map((e) => e.when)).size).toBe(
		journal.entries.length,
	);
	expect(tags.size).toBe(journal.entries.length);
	for (const [idx, entry] of journal.entries.entries()) {
		expect(entry.idx, entry.tag).toBe(idx);
		expect(Number.isSafeInteger(entry.when), entry.tag).toBe(true);
		expect(files).toContain(`${entry.tag}.sql`);
	}
	for (const file of files) {
		const tag = file.slice(0, -4);
		if (!tags.has(tag))
			expect(tags.has(historicalRecoveries[tag]), file).toBe(true);
	}
});

it("journal timestamps increase except for explicitly recovered historical gaps", () => {
	let highest = 0;
	for (const entry of journal.entries) {
		if (entry.when <= highest) {
			const recovery = journal.entries.find(
				(e) => e.tag === historicalRecoveries[entry.tag],
			);
			expect(
				recovery?.when ?? 0,
				`${entry.tag} must have a later journaled recovery`,
			).toBeGreaterThan(highest);
		}
		highest = Math.max(highest, entry.when);
	}
});
