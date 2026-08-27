import { describe, expect, it } from "vitest";
import * as generatedAuthSchema from "@/db/auth-schema";
import * as applicationSchema from "@/db/schema";

describe("authDatabaseSchema", () => {
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
