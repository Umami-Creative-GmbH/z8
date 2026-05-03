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
});
