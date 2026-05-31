import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("InviteCodeManagement responsive UX", () => {
	it("keeps the table for desktop and renders mobile invite cards", () => {
		const source = readFileSync(
			join(process.cwd(), "src/components/organization/invite-code-management.tsx"),
			"utf8",
		);

		expect(source).toContain("hidden md:block");
		expect(source).toContain("md:hidden");
		expect(source).toContain("InviteCodeMobileCard");
	});

	it("makes copy URL and QR primary mobile actions", () => {
		const source = readFileSync(
			join(process.cwd(), "src/components/organization/invite-code-management.tsx"),
			"utf8",
		);

		expect(source).toContain("settings.inviteCodes.copyUrl");
		expect(source).toContain("settings.inviteCodes.qrCode");
		expect(source).toContain("font-mono text-sm font-semibold tracking-[0.12em]");
		expect(source).toContain("sm:text-base sm:tracking-[0.18em]");
	});

	it("prevents mobile invite cards from overflowing narrow screens", () => {
		const source = readFileSync(
			join(process.cwd(), "src/components/organization/invite-code-management.tsx"),
			"utf8",
		);

		expect(source).toContain("min-w-0 items-center gap-2");
		expect(source).toContain("max-w-full truncate");
		expect(source).toContain("grid-cols-1 sm:grid-cols-2");
		expect(source).toContain("min-w-0 whitespace-normal text-center");
	});

	it("keeps invite panels readable on mobile", () => {
		const createPanel = readFileSync(
			join(process.cwd(), "src/components/organization/invite-code-dialog.tsx"),
			"utf8",
		);
		const memberPanel = readFileSync(
			join(process.cwd(), "src/components/organization/invite-member-dialog.tsx"),
			"utf8",
		);
		const qrPanel = readFileSync(
			join(process.cwd(), "src/components/organization/invite-code-qr-dialog.tsx"),
			"utf8",
		);

		expect(createPanel).toContain("flex flex-col gap-2 sm:flex-row");
		expect(createPanel).toContain("space-y-5");
		expect(memberPanel).toContain("space-y-5");
		expect(qrPanel).toContain("break-all");
		expect(qrPanel).toContain("size-[min(256px,70vw)]");
	});

	it("uses target team copy while preserving the defaultTeamId payload field", () => {
		const createPanel = readFileSync(
			join(process.cwd(), "src/components/organization/invite-code-dialog.tsx"),
			"utf8",
		);

		expect(createPanel).toContain('t("settings.inviteCodes.targetTeam", "Target team")');
		expect(createPanel).toContain('t("settings.inviteCodes.noTargetTeam", "No team")');
		expect(createPanel).toContain('"settings.inviteCodes.targetTeamHelp"');
		expect(createPanel).toContain('"New members will use this team by default when they join."');
		expect(createPanel).toContain("defaultTeamId: formValues.defaultTeamId || undefined");
		expect(createPanel).toContain("defaultTeamId: formValues.defaultTeamId || null");
	});

	it("shows the target team column on desktop and mobile invite code cards", () => {
		const source = readFileSync(
			join(process.cwd(), "src/components/organization/invite-code-management.tsx"),
			"utf8",
		);

		expect(source).toContain('t("settings.inviteCodes.targetTeam", "Target team")');
		expect(source).toContain('code.defaultTeam?.name || "-"');
		expect(source).toContain("sm:grid-cols-2");
	});

	it("makes pending-member invite-code team prefill explicitly clearable", () => {
		const source = readFileSync(
			join(process.cwd(), "src/components/organization/pending-members-card.tsx"),
			"utf8",
		);

		expect(source).toContain("useState<Record<string, string | null>>({})");
		expect(source).toContain('const NO_TEAM_VALUE = "none"');
		expect(source).toContain("member.id in teamAssignments");
		expect(source).toContain("teamAssignments[member.id] === null");
		expect(source).toContain("member.inviteCode?.defaultTeamId");
	});
});
