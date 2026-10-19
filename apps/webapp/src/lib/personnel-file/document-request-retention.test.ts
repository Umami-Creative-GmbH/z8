import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { runDocumentRequestRetention } from "./document-request-retention";

/**
 * A database whose queries answer in turn: the personnel-file organizations,
 * then each organization's retention periods (an Error is thrown instead).
 */
function scriptedDatabase(answers: unknown[]) {
	let call = 0;
	const query = {
		from: () => query,
		where: () => {
			const answer = answers[call++];
			return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
		},
	};
	return { select: () => query } as never;
}

describe("runDocumentRequestRetention", () => {
	it("counts an organization whose run fails in its result and still runs the others", async () => {
		const result = await runDocumentRequestRetention(
			scriptedDatabase([[{ id: "org-a" }, { id: "org-b" }], new Error("connection reset"), []]),
			{ now: Temporal.Instant.from("2028-01-05T09:00:00Z") },
		);
		expect(result).toEqual({
			success: false,
			organizations: 1,
			deleted: 0,
			failed: 0,
			errors: [{ organizationId: "org-a", error: "connection reset" }],
		});
	});
});
