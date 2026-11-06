import { getAuthTables } from "@better-auth/core/db";
import { getTableColumns, getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as authSchema from "@/db/auth-schema";
import { auth } from "./auth.cli";

/** The generator's snake case: `credentialID` → `credential_id`, `ssoProvider` → `sso_provider`. */
function snakeCase(value: string) {
	return value
		.replace(/([a-z\d])([A-Z])/g, "$1_$2")
		.replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
		.toLowerCase();
}

/** Table name → sorted column names, as `pnpm auth:generate` would write them. */
function configuredTables() {
	return Object.fromEntries(
		Object.values(getAuthTables(auth.options))
			.filter((table) => !table.disableMigrations)
			.map((table) => [
				snakeCase(table.modelName),
				[
					"id",
					...Object.entries(table.fields).map(([key, field]) =>
						snakeCase(field.fieldName ?? key),
					),
				].sort(),
			]),
	);
}

/** Table name → sorted column names of the committed generated schema. */
function generatedTables() {
	return Object.fromEntries(
		Object.values(authSchema)
			.filter((value): value is PgTable => is(value, PgTable))
			.map((table) => [
				getTableName(table),
				Object.values(getTableColumns(table))
					.map((column) => column.name)
					.sort(),
			]),
	);
}

describe("auth CLI config", () => {
	it("describes exactly the committed auth schema (run `pnpm auth:generate` after changing it)", () => {
		expect(generatedTables()).toEqual(configuredTables());
	});
});
