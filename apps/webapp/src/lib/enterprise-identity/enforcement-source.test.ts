import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const organizationsActionsSource = readFileSync(
	join(process.cwd(), "src/app/[locale]/(app)/settings/organizations/actions.ts"),
	"utf8",
);
const inviteCodeServiceSource = readFileSync(
	join(process.cwd(), "src/lib/effect/services/invite-code.service.ts"),
	"utf8",
);
const enforcementSource = readFileSync(
	join(process.cwd(), "src/lib/enterprise-identity/enforcement.ts"),
	"utf8",
);

describe("enterprise identity enforcement source contracts", () => {
	it("enforces active invite restrictions before direct invitations", () => {
		expect(organizationsActionsSource).toContain("assertEnterpriseIdentityInvitationAllowed");
		expect(enforcementSource).toContain("inviteRestrictionEnabled");
		expect(organizationsActionsSource).toContain("validatedData.email");
	});

	it("enforces active domain restrictions before invite code membership creation", () => {
		expect(inviteCodeServiceSource).toContain("assertEnterpriseIdentityInviteCodeRedemptionAllowed");
		expect(enforcementSource).toContain("domainRestrictionEnabled");
		expect(inviteCodeServiceSource).toContain("input.userId");
		expect(inviteCodeServiceSource.indexOf("assertEnterpriseIdentityInviteCodeRedemptionAllowed")).toBeLessThan(
			inviteCodeServiceSource.indexOf("createMember"),
		);
	});
});
