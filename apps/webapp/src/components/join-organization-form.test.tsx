import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("JoinOrganizationForm mobile UX", () => {
	it("stacks invite code validation controls on mobile", () => {
		const source = readFileSync(
			join(process.cwd(), "src/components/join-organization-form.tsx"),
			"utf8",
		);

		expect(source).toContain("flex flex-col gap-2 sm:flex-row");
		expect(source).toContain("font-mono uppercase tracking-[0.2em]");
		expect(source).toContain("w-full sm:w-auto");
	});

	it("uses full-width status cards for terminal invite states", () => {
		const source = readFileSync(
			join(process.cwd(), "src/components/join-organization-form.tsx"),
			"utf8",
		);

		expect(source).toContain("mx-auto w-full max-w-md");
		expect(source).toContain(
			'CardFooter className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-center"',
		);
	});
});
