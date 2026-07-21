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
});
