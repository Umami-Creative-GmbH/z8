import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as generatedAuthSchema from "@/db/auth-schema";
import * as applicationSchema from "@/db/schema";

describe("authDatabaseSchema", () => {
	it("accepts Better Auth 1.7.3 account writes without an issuer", () => {
		const { columns, indexes } = getTableConfig(generatedAuthSchema.account);
		expect(columns.some((column) => column.name === "issuer" && column.notNull)).toBe(false);
		expect(indexes.some((index) => index.config.name === "account_issuer_accountId_uidx")).toBe(false);
	});
	it("exposes application and generated SCIM models to the Better Auth adapter", async () => {
		const { authDatabaseSchema } = await import("./auth-database-schema");

		expect(authDatabaseSchema.employee).toBe(applicationSchema.employee);
		expect(authDatabaseSchema.scimProviderConfig).toBe(
			applicationSchema.scimProviderConfig,
		);
		expect(authDatabaseSchema.roleTemplate).toBe(
			applicationSchema.roleTemplate,
		);
		expect(authDatabaseSchema.scimUser).toBe(generatedAuthSchema.scimUser);
		expect(authDatabaseSchema.scimGroup).toBe(generatedAuthSchema.scimGroup);
		expect(authDatabaseSchema.scimManagedConnection).toBe(
			generatedAuthSchema.scimManagedConnection,
		);
		expect(authDatabaseSchema.organizationRelations).toBe(
			generatedAuthSchema.organizationRelations,
		);
	});
});
