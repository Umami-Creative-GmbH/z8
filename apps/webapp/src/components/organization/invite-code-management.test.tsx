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
		expect(source).toContain("font-mono text-base font-semibold tracking-[0.18em]");
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
});
