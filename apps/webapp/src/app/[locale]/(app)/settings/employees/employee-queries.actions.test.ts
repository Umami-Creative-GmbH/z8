import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
	fileURLToPath(new URL("./employee-queries.actions.ts", import.meta.url)),
	"utf8",
);
const typeSource = readFileSync(
	fileURLToPath(new URL("./employee-action-types.ts", import.meta.url)),
	"utf8",
);
const eligibilitySource = readFileSync(
	fileURLToPath(new URL("./employee-invitation-draft-eligibility.ts", import.meta.url)),
	"utf8",
);

describe("employee query name source", () => {
	it("uses auth user structured names for employee search and sort", () => {
		expect(source).toContain("$" + "{user.firstName}");
		expect(source).toContain("$" + "{user.lastName}");
		expect(source).toContain("ilike(user.firstName, pattern)");
		expect(source).toContain("ilike(user.lastName, pattern)");
		expect(source).not.toContain("ilike(employee.firstName, pattern)");
		expect(source).not.toContain("ilike(employee.lastName, pattern)");
	});

	it("mirrors auth structured names onto selectable root fields", () => {
		expect(source).toContain("firstName: row.user.firstName");
		expect(source).toContain("lastName: row.user.lastName");
		expect(source).not.toContain("firstName: row.employee.firstName");
		expect(source).not.toContain("lastName: row.employee.lastName");
	});

	it("includes invitation draft rows for org admins", () => {
		expect(source).toContain("employeeInvitationDraft");
		expect(source).toContain('kind: "invitationDraft"');
		expect(source).toContain('actor.accessTier === "orgAdmin"');
		expect(source).toContain("decodeEmployeeInvitationDraftId(employeeId)");
	});

	it("searches invitation drafts by prepared names, email, and position", () => {
		expect(source).toContain("ilike(employeeInvitationDraft.firstName, pattern)");
		expect(source).toContain("ilike(employeeInvitationDraft.lastName, pattern)");
		expect(source).toContain("ilike(invitation.email, pattern)");
		expect(source).toContain("ilike(employeeInvitationDraft.position, pattern)");
	});

	it("uses literal employee kind for discriminated directory rows", () => {
		expect(typeSource).toContain('kind: "employee"');
		expect(typeSource).not.toContain("kind: EmployeeRecordKind");
	});

	it("uses the shared pending-future eligibility predicate for draft list and detail queries", () => {
		expect(source).toContain("buildEligibleInvitationDraftPredicate");
		expect(source).toContain("buildInvitationDraftFilters(actor.organizationId, now, params)");
		expect(source).toContain("draftId,");
		expect(source.match(/buildEligibleInvitationDraftPredicate\(\{/g)).toHaveLength(2);
		expect(source.match(/dateFromInstant\(systemClock\.nowInstant\(\)\)/g)).toHaveLength(2);
	});

	it("keeps managers on the real-employee-only path", () => {
		expect(source).toContain('const includeInvitationDrafts = actor.accessTier === "orgAdmin"');
		expect(source).toContain("if (!includeInvitationDrafts)");
	});

	it("suppresses only same-organization employee identities by normalized email", () => {
		expect(eligibilitySource).toContain("lower(btrim($" + "{user.email}))");
		expect(eligibilitySource).toContain("$" + "{employeeInvitationDraft.normalizedEmail}");
		expect(eligibilitySource).toContain("$" + "{employee.organizationId} = $" + "{organizationId}");
		expect(eligibilitySource).not.toContain("invitedVia");
	});

	it("does not use invitedVia joins or detection for draft eligibility", () => {
		expect(source).not.toContain("realEmployeeUser");
		expect(source).not.toContain("const realEmployee");
		expect(source).not.toContain("realEmployee:");
		expect(source).not.toContain(".invitedVia");
	});

	it("organization-scopes the final invitation draft detail predicate", () => {
		expect(source).toContain("organizationId: actor.organizationId");
		expect(source).toContain("draftId,");
	});

	it("selects one deterministic approved membership without filtering out employees", () => {
		expect(source).toContain("leftJoinLateral");
		expect(source).toContain('eq(member.status, "approved")');
		expect(source).toContain("eq(member.userId, employee.userId)");
		expect(source).toContain("eq(member.organizationId, actor.organizationId)");
		expect(source).toContain("desc(member.createdAt)");
		expect(source).toContain("desc(member.id)");
		expect(source).toContain(".limit(1)");
	});

	it("normalizes nullable joined memberships and keeps drafts membership-free", () => {
		expect(source).toContain("membership: row.membership?.id ? row.membership : null");
		expect(source).toContain("membership: null");
	});

	it("organization-scopes the final real employee detail lookup", () => {
		expect(source).toContain(
			"where: and(eq(employee.id, employeeId), eq(employee.organizationId, actor.organizationId))",
		);
	});
});
