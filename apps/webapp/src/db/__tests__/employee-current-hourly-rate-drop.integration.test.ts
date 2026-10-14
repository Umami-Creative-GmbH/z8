/**
 * #1179: employment terms are the only wage history (Organization ADR 0002), so the migration
 * chain drops the denormalized `employee.current_hourly_rate`. The invitation draft keeps its
 * own wage: it feeds the employee's first terms.
 */
import { describe, expect, it } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

async function columnsNamed(table: string, column: string) {
	const result = await integrationAdminPool().query<{ column_name: string }>(
		`select column_name from information_schema.columns
		 where table_schema = 'public' and table_name = $1 and column_name = $2`,
		[table, column],
	);
	return result.rows.map((row) => row.column_name);
}

describe("0224 drop employee current hourly rate", () => {
	it("leaves the employee without a stored wage", async () => {
		expect(await columnsNamed("employee", "current_hourly_rate")).toEqual([]);
	});

	it("keeps the invitation draft's wage for the first terms", async () => {
		expect(await columnsNamed("employee_invitation_draft", "current_hourly_rate")).toEqual([
			"current_hourly_rate",
		]);
	});
});
