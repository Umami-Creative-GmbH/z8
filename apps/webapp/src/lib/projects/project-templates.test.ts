import { describe, expect, it } from "vitest";
import { getProjectTemplate, listProjectTemplates } from "./project-templates";

/**
 * A reader that answers every query after a tick and records how many ran at
 * once. A transaction client serves one query at a time, so a template read
 * handed a transaction must never overlap its queries.
 */
function sequentialOnlyReader(firstRows: unknown[]) {
	let running = 0;
	let calls = 0;
	const state = { maxConcurrent: 0 };
	const query = () => {
		const rows = calls === 0 ? firstRows : [];
		calls += 1;
		const chain: Record<string, unknown> = {};
		for (const step of ["from", "where", "limit", "orderBy", "leftJoin", "innerJoin", "groupBy"]) {
			chain[step] = () => chain;
		}
		chain.then = (resolve: (value: unknown) => void) => {
			running += 1;
			state.maxConcurrent = Math.max(state.maxConcurrent, running);
			setTimeout(() => {
				running -= 1;
				resolve(rows);
			}, 1);
		};
		return chain;
	};
	return { reader: { select: query } as never, state };
}

describe("template reads on a transaction client", () => {
	it("read a template's tasks, managers and assignments one query at a time", async () => {
		const { reader, state } = sequentialOnlyReader([{ id: "template-1", name: "Relaunch" }]);

		await getProjectTemplate({ organizationId: "org-1", templateId: "template-1" }, reader);

		expect(state.maxConcurrent).toBe(1);
	});

	it("list templates with their counts one query at a time", async () => {
		const { reader, state } = sequentialOnlyReader([]);

		await listProjectTemplates({ organizationId: "org-1" }, reader);

		expect(state.maxConcurrent).toBe(1);
	});
});
