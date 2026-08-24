import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const schemaDirectory = fileURLToPath(new URL("../", import.meta.url));

describe("schema import boundaries", () => {
	it("keeps schema declarations independent from the Temporal runtime adapter", () => {
		const runtimeAdapterImports = readdirSync(schemaDirectory)
			.filter((fileName) => fileName.endsWith(".ts"))
			.filter((fileName) =>
				readFileSync(`${schemaDirectory}/${fileName}`, "utf8").includes(
					'from "@/lib/datetime/drizzle-adapter"',
				),
			);

		expect(runtimeAdapterImports).toEqual([]);
	});

	it("keeps Better Auth SCIM models in the generated auth schema", () => {
		const generatedAuthSchema = readFileSync(
			`${schemaDirectory}/../auth-schema.ts`,
			"utf8",
		);
		const expectedModels = [
			"scimManagedConnection",
			"scimManagedCredential",
			"scimManagedConnectionEvent",
			"scimConnectionBinding",
			"scimIdentityTombstone",
			"scimSubject",
			"scimUser",
			"scimProjectionGrant",
			"scimGroup",
			"scimGroupMember",
		];

		for (const model of expectedModels) {
			expect(generatedAuthSchema).toContain(`export const ${model} = pgTable(`);
		}
		expect(generatedAuthSchema).not.toContain("scimProviderConfig");
		expect(generatedAuthSchema).not.toContain("scimRoleMapping");
		expect(generatedAuthSchema).not.toContain("scimRoleTemplate");
	});
});
