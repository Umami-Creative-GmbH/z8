import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";
import { resolveStoreAppSignInOrigin } from "./sign-in-origin";

const admin = integrationAdminPool();
const mainOrigin = "https://ui.example.test";
const ids = {
	owner: "t842-owner",
	acme: "t842-org-acme",
	globex: "t842-org-globex",
	initech: "t842-org-initech",
};

async function cleanup() {
	await admin.query("delete from organization where id = any($1)", [
		[ids.acme, ids.globex, ids.initech],
	]);
	await admin.query('delete from "user" where id = $1', [ids.owner]);
}

beforeEach(async () => {
	await cleanup();
	await admin.query(
		'insert into "user"(id,name,email,created_at,updated_at) values ($1,$1,$2,now(),now())',
		[ids.owner, "t842-owner@example.test"],
	);
	await admin.query(
		`insert into organization (id, name, slug, created_at)
		 values ($1, 'T842 Acme', $1, now()), ($2, 'T842 Globex', $2, now()), ($3, 'T842 Initech', $3, now())`,
		[ids.acme, ids.globex, ids.initech],
	);
	await admin.query(
		`insert into organization_domain (organization_id, domain, domain_verified, is_primary, updated_at)
		 values ($1, 'time.t842-acme.example', true, true, now()),
		        ($2, 'zeit.t842-globex-gruppe.example', true, true, now()),
		        ($3, 'login.t842-initech.example', false, true, now())`,
		[ids.acme, ids.globex, ids.initech],
	);
	await admin.query(
		`insert into sso_provider (id, issuer, user_id, provider_id, organization_id, domain, domain_verified)
		 values ('t842-globex-idp', 'https://idp.t842-globex.example', $1, 't842-globex-idp', $2, 't842-globex.example', true),
		        ('t842-unverified-idp', 'https://idp.t842-unverified.example', $1, 't842-unverified-idp', $3, 't842-initech.example', false)`,
		[ids.owner, ids.globex, ids.initech],
	);
});

afterAll(cleanup);

describe("store app sign-in origin on the migrated schema", () => {
	it("starts on the verified custom domain under the email's domain", async () => {
		await expect(
			resolveStoreAppSignInOrigin("ada@T842-Acme.example", mainOrigin),
		).resolves.toBe("https://time.t842-acme.example");
	});

	it("starts on the custom domain of the organization with the verified SSO domain", async () => {
		await expect(
			resolveStoreAppSignInOrigin("ada@t842-globex.example", mainOrigin),
		).resolves.toBe("https://zeit.t842-globex-gruppe.example");
	});

	it.each([
		["an unverified custom domain and SSO domain", "ada@t842-initech.example"],
		["an email domain no organization verified", "ada@t842-unknown.example"],
		["a LIKE wildcard in the email's domain", "ada@t842-%.example"],
	])("uses the main origin for %s", async (_case, email) => {
		await expect(resolveStoreAppSignInOrigin(email, mainOrigin)).resolves.toBe(mainOrigin);
	});
});
