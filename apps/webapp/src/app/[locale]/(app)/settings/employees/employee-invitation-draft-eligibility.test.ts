import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { buildEligibleInvitationDraftPredicate } from "./employee-invitation-draft-eligibility";

function compilePredicate(input: {
	organizationId: string;
	now: Date;
	draftId?: string;
}) {
	return new PgDialect().sqlToQuery(
		buildEligibleInvitationDraftPredicate(input),
	);
}

describe("buildEligibleInvitationDraftPredicate", () => {
	it("links the draft to the invitation being evaluated", () => {
		const query = compilePredicate({
			organizationId: "org-1",
			now: new Date("2026-07-18T12:00:00.000Z"),
		});

		expect(query.sql).toContain(
			'"employee_invitation_draft"."invitation_id" = "invitation"."id"',
		);
	});

	it("requires the draft and invitation to belong to the requested organization", () => {
		const query = compilePredicate({
			organizationId: "org-requested",
			now: new Date("2026-07-18T12:00:00.000Z"),
		});

		expect(query.sql).toContain(
			'"employee_invitation_draft"."organization_id" = $1',
		);
		expect(query.sql).toContain('"invitation"."organization_id" = $2');
		expect(query.params.slice(0, 2)).toEqual([
			"org-requested",
			"org-requested",
		]);
	});

	it("requires a pending invitation whose expiry is strictly in the future", () => {
		const now = new Date("2026-07-18T12:00:00.000Z");
		const query = compilePredicate({ organizationId: "org-1", now });

		expect(query.sql).toContain('"invitation"."status" = $3');
		expect(query.sql).toContain('"invitation"."expires_at" > $4');
		expect(query.params[2]).toBe("pending");
		expect(query.params[3]).toBe(now.toISOString());
	});

	it("optionally restricts eligibility to one draft", () => {
		const query = compilePredicate({
			organizationId: "org-1",
			now: new Date("2026-07-18T12:00:00.000Z"),
			draftId: "draft-1",
		});

		expect(query.sql).toContain('"employee_invitation_draft"."id" = $5');
		expect(query.params[4]).toBe("draft-1");
	});

	it("does not add a draft id condition when no draft id is supplied", () => {
		const query = compilePredicate({
			organizationId: "org-1",
			now: new Date("2026-07-18T12:00:00.000Z"),
		});

		expect(query.sql).not.toContain('"employee_invitation_draft"."id" =');
	});

	it("suppresses drafts matching a joined user email only for employees in the same organization", () => {
		const query = compilePredicate({
			organizationId: "org-requested",
			now: new Date("2026-07-18T12:00:00.000Z"),
		});
		const normalizedSql = query.sql.replace(/\s+/g, " ");

		expect(normalizedSql).toContain('not exists ( select 1 from "employee"');
		expect(normalizedSql).toContain(
			'inner join "user" on "employee"."user_id" = "user"."id"',
		);
		expect(normalizedSql).toContain('"employee"."organization_id" = $5');
		expect(normalizedSql).toContain(
			'lower(btrim("user"."email")) = "employee_invitation_draft"."normalized_email"',
		);
		expect(query.params[4]).toBe("org-requested");
		expect(normalizedSql).not.toContain('"user"."invited_via"');
	});
});
