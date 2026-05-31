import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = () =>
	readFileSync(join(process.cwd(), "src/components/organization/invite-member-dialog.tsx"), "utf8");

describe("InviteMemberDialog target team form", () => {
	it("uses TanStack Form and loads teams only while open", () => {
		const file = source();

		expect(file).toContain('import { useForm } from "@tanstack/react-form"');
		expect(file).toContain("useQuery");
		expect(file).toContain("useMutation");
		expect(file).toContain("useQueryClient");
		expect(file).toContain(
			'import { listTeams } from "@/app/[locale]/(app)/settings/teams/actions"',
		);
		expect(file).toContain("queryKeys.teams.list(organizationId)");
		expect(file).toContain("enabled: open");
	});

	it("submits targetTeamId using the none sentinel and resets on success", () => {
		const file = source();

		expect(file).toContain('targetTeamId: "none"');
		expect(file).toContain('value.targetTeamId === "none" ? null : value.targetTeamId');
		expect(file).toContain("form.reset()");
	});

	it("renders an accessible target team select below role", () => {
		const file = source();

		expect(file).toContain('htmlFor="targetTeam"');
		expect(file).toContain('id="targetTeam"');
		expect(file).toContain('aria-label={t("organization.invite.targetTeam"');
		expect(file.indexOf('htmlFor="role"')).toBeLessThan(file.indexOf('htmlFor="targetTeam"'));
	});
});
