import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript/unstable/ast";
import { describe, expect, it, vi } from "vitest";
import * as nativeSourceAnalysis from "@/lib/typescript/native-source-analysis";

function readOrganizationComponent(fileName: string) {
	return readFileSync(
		join(process.cwd(), `src/components/organization/${fileName}.tsx`),
		"utf8",
	);
}

function getOversizedComponents(sources: ReadonlyMap<string, string>) {
	const entryFileName = sources.keys().next().value;
	if (!entryFileName) throw new Error("No organization components to analyze");

	return nativeSourceAnalysis.withNativeProgram(
		sources,
		entryFileName,
		({ program }) => {
			const oversizedByFile = new Map<string, string[]>();

			for (const fileName of sources.keys()) {
				const normalizedPath = `/${fileName.replaceAll("\\", "/")}`;
				const sourceFile = program.getSourceFile(normalizedPath);
				if (!sourceFile) {
					throw new Error(`Native source file not found: ${normalizedPath}`);
				}
				const oversized: string[] = [];

				function visit(node: ts.Node) {
					if (
						ts.isFunctionDeclaration(node) &&
						node.name &&
						/^[A-Z]/.test(node.name.text) &&
						node.body
					) {
						const start = sourceFile.getLineAndCharacterOfPosition(
							node.body.getStart(),
						).line;
						const end = sourceFile.getLineAndCharacterOfPosition(
							node.body.getEnd(),
						).line;
						if (end - start + 1 > 300) oversized.push(node.name.text);
					}
					node.forEachChild(visit);
				}

				visit(sourceFile);
				oversizedByFile.set(fileName, oversized);
			}

			return oversizedByFile;
		},
	);
}

describe("InviteCodeManagement responsive UX", () => {
	it("keeps organization management components within coherent AST-sized boundaries", () => {
		const expectedExtractions = {
			"invite-code-dialog": ["InviteCodeFormFields"],
			"invite-code-management": [
				"InviteCodeDesktopTable",
				"InviteCodeDialogStack",
			],
			"members-table": [
				"useMembersTableController",
				"MembersView",
				"InvitationsView",
			],
			"pending-members-card": [
				"PendingMembersTable",
				"PendingMemberDialogStack",
			],
			"teams-tab": ["TeamsView", "TeamDialogStack"],
		};
		const sources = new Map(
			Object.keys(expectedExtractions).map((fileName) => [
				`${fileName}.tsx`,
				readOrganizationComponent(fileName),
			]),
		);
		const withNativeProgram = vi.spyOn(
			nativeSourceAnalysis,
			"withNativeProgram",
		);
		const withNativeSource = vi.spyOn(nativeSourceAnalysis, "withNativeSource");
		let oversizedByFile: Map<string, string[]> | undefined;
		let nativeProgramCallCount = 0;
		let nativeSourceCallCount = 0;

		try {
			oversizedByFile = getOversizedComponents(sources);
		} finally {
			nativeProgramCallCount = withNativeProgram.mock.calls.length;
			nativeSourceCallCount = withNativeSource.mock.calls.length;
			try {
				withNativeProgram.mockRestore();
			} finally {
				withNativeSource.mockRestore();
			}
		}

		for (const [fileName, extractions] of Object.entries(expectedExtractions)) {
			const source = sources.get(`${fileName}.tsx`);
			if (!source)
				throw new Error(`Organization source not found: ${fileName}`);
			for (const extraction of extractions) {
				expect(source, `${fileName} should define ${extraction}`).toContain(
					`function ${extraction}`,
				);
			}
			expect(oversizedByFile.get(`${fileName}.tsx`)).toEqual([]);
		}
		expect(nativeProgramCallCount).toBe(1);
		expect(nativeSourceCallCount).toBe(0);
	});

	it("keeps the table for desktop and renders mobile invite cards", () => {
		const source = readFileSync(
			join(
				process.cwd(),
				"src/components/organization/invite-code-management.tsx",
			),
			"utf8",
		);

		expect(source).toContain("hidden md:block");
		expect(source).toContain("md:hidden");
		expect(source).toContain("InviteCodeMobileCard");
	});

	it("makes copy URL and QR primary mobile actions", () => {
		const source = readFileSync(
			join(
				process.cwd(),
				"src/components/organization/invite-code-management.tsx",
			),
			"utf8",
		);

		expect(source).toContain("settings.inviteCodes.copyUrl");
		expect(source).toContain("settings.inviteCodes.qrCode");
		expect(source).toContain(
			"font-mono text-sm font-semibold tracking-[0.12em]",
		);
		expect(source).toContain("sm:text-base sm:tracking-[0.18em]");
	});

	it("prevents mobile invite cards from overflowing narrow screens", () => {
		const source = readFileSync(
			join(
				process.cwd(),
				"src/components/organization/invite-code-management.tsx",
			),
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
			join(
				process.cwd(),
				"src/components/organization/invite-member-dialog.tsx",
			),
			"utf8",
		);
		const qrPanel = readFileSync(
			join(
				process.cwd(),
				"src/components/organization/invite-code-qr-dialog.tsx",
			),
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

		expect(createPanel).toContain(
			't("settings.inviteCodes.targetTeam", "Target team")',
		);
		expect(createPanel).toContain(
			't("settings.inviteCodes.noTargetTeam", "No team")',
		);
		expect(createPanel).toContain('"settings.inviteCodes.targetTeamHelp"');
		expect(createPanel).toContain(
			'"New members will use this team by default when they join."',
		);
		expect(createPanel).toContain(
			"defaultTeamId: formValues.defaultTeamId || undefined",
		);
		expect(createPanel).toContain(
			"defaultTeamId: formValues.defaultTeamId || null",
		);
	});

	it("shows the target team column on desktop and mobile invite code cards", () => {
		const source = readFileSync(
			join(
				process.cwd(),
				"src/components/organization/invite-code-management.tsx",
			),
			"utf8",
		);

		expect(source).toContain(
			't("settings.inviteCodes.targetTeam", "Target team")',
		);
		expect(source).toContain('code.defaultTeam?.name || "-"');
		expect(source).toContain("sm:grid-cols-2");
	});

	it("makes pending-member invite-code team prefill explicitly clearable", () => {
		const componentSource = readFileSync(
			join(
				process.cwd(),
				"src/components/organization/pending-members-card.tsx",
			),
			"utf8",
		);
		const utilsSource = readFileSync(
			join(
				process.cwd(),
				"src/components/organization/pending-members-card.utils.ts",
			),
			"utf8",
		);

		expect(componentSource).toMatch(
			/useState<\s*Record<string, string \| null>\s*>\(\{\}\)/,
		);
		expect(componentSource).toContain('const NO_TEAM_VALUE = "none"');
		expect(utilsSource).toContain("member.id in teamAssignments");
		expect(utilsSource).toContain("teamAssignments[member.id] === null");
		expect(utilsSource).toContain("member.inviteCode?.defaultTeamId");
	});
});
