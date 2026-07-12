import { describe, expect, it } from "vitest";
import { buildCsvContent } from "./helpers";

describe("work policy compliance helpers", () => {
	it("escapes quotes, commas, and line breaks in CSV cells", () => {
		expect(
			buildCsvContent(
				["Employee", "Acknowledged Note"],
				[["Avery, Stone", 'Reviewed "with manager"\nFollow-up scheduled']],
			),
		).toBe(
			'Employee,Acknowledged Note\n"Avery, Stone","Reviewed ""with manager""\nFollow-up scheduled"',
		);
	});
});
