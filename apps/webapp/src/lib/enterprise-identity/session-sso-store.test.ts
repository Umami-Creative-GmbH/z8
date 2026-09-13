import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { sessionSsoProvenance } from "@/db/schema/session-sso-provenance";
import { resolveOrganizationSsoPolicy } from "./session-sso-store";

describe("persisted SSO provenance and live policy", () => {
	it("requires activated policy and a consistently configured provider, failing closed on drift", () => {
		const setup = {
			activated: true,
			enforcement: { ssoRequired: true },
			providerId: "idp",
		};
		const org = "idp";
		expect(resolveOrganizationSsoPolicy(setup, org)).toEqual({
			required: true,
			providerId: "idp",
		});
		expect(resolveOrganizationSsoPolicy(null, org)).toEqual({
			required: false,
			providerId: null,
		});
		expect(
			resolveOrganizationSsoPolicy({ ...setup, activated: false }, org)
				.required,
		).toBe(false);
		expect(
			resolveOrganizationSsoPolicy(
				{ ...setup, enforcement: { ssoRequired: false } },
				org,
			).required,
		).toBe(false);
		for (const drift of [null, "other"]) {
			expect(resolveOrganizationSsoPolicy(setup, drift)).toEqual({
				required: true,
				providerId: null,
			});
		}
	});

	it("binds proof to the session lifetime and tenant with cascading foreign keys", () => {
		const config = getTableConfig(sessionSsoProvenance);
		expect(
			config.foreignKeys.map((fk) => [
				fk.reference().columns[0].name,
				fk.onDelete,
			]),
		).toEqual(
			expect.arrayContaining([
				["session_id", "cascade"],
				["organization_id", "cascade"],
			]),
		);
		expect(
			config.columns.find((column) => column.name === "session_id")?.primary,
		).toBe(true);
	});

	it("registers the migration after every previous migration timestamp", () => {
		const journal = JSON.parse(
			readFileSync(
				new URL("../../../drizzle/meta/_journal.json", import.meta.url),
				"utf8",
			),
		);
		const entry = journal.entries.find(
			(item: { tag: string }) => item.tag === "0067_session_sso_provenance",
		);
		expect(entry).toBeDefined();
		expect(entry.when).toBeGreaterThan(
			Math.max(
				...journal.entries
					.filter((item: { idx: number }) => item.idx < entry.idx)
					.map((item: { when: number }) => item.when),
			),
		);
	});
});
