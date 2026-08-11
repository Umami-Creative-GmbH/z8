import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as ts from "typescript/unstable/ast";
import { afterAll, describe, expect, it, vi } from "vitest";
import * as nativeSourceAnalysis from "@/lib/typescript/native-source-analysis";

const TARGETS = [
	["audit-export/audit-pack-generator-card.tsx", "AuditPackGeneratorCard"],
	[
		"audit-export/audit-pack-generator-card.tsx",
		"AuditPackGeneratorCardForOrganization",
	],
	["audit-export/audit-pack-generator-card.tsx", "AuditPackRequestForm"],
	["audit-export/key-management.tsx", "KeyManagement"],
	["audit-log-viewer.tsx", "AuditLogViewer"],
	["audit-log-viewer.tsx", "AuditLogViewerForOrganization"],
	["audit-log-viewer.tsx", "AuditLogResults"],
	["clockin-import/clockin-import-wizard.tsx", "ClockinImportWizard"],
	["clockin-import/clockin-import-controller.ts", "useClockinImportController"],
	["clockin-import/clockin-import-steps.tsx", "ClockinImportStepRenderer"],
	["clockodo-import/clockodo-import-wizard.tsx", "ClockodoImportWizard"],
	[
		"clockodo-import/clockodo-import-controller.ts",
		"useClockodoImportController",
	],
	["clockodo-import/clockodo-import-steps.tsx", "ClockodoImportStepRenderer"],
	["export/storage-settings-form.tsx", "StorageSettingsForm"],
	["scheduled-exports/execution-history-dialog.tsx", "ExecutionHistoryDialog"],
	["shift-template-management.tsx", "ShiftTemplateManagement"],
	["shift-template-management.tsx", "ShiftTemplateDialog"],
	["surcharge-assignment-manager.tsx", "SurchargeAssignmentManager"],
	["surcharge-assignment-cards.tsx", "SurchargeTeamAssignmentsCard"],
	["surcharge-management.tsx", "SurchargeManagement"],
	["surcharge-model-list.tsx", "SurchargeModelList"],
	["surcharge-rule-editor.tsx", "SurchargeRuleEditor"],
	["surcharge-rule-fields.tsx", "SurchargeRuleBaseFields"],
	[
		"shift-template-management-controller.ts",
		"useShiftTemplateManagementController",
	],
	["shift-template-management-sections.tsx", "ShiftTemplatePreview"],
] as const;

const withNativeSource = vi.spyOn(nativeSourceAnalysis, "withNativeSource");
const lineCountsByPath = new Map<string, Map<string, number>>();

function componentLineCounts(relativePath: string) {
	const path = fileURLToPath(new URL(relativePath, import.meta.url));
	const cachedCounts = lineCountsByPath.get(path);
	if (cachedCounts) return cachedCounts;

	const sourceText = readFileSync(path, "utf8");
	const counts = nativeSourceAnalysis.withNativeSource(
		sourceText,
		path,
		({ sourceFile }) => {
			const fileCounts = new Map<string, number>();

			function visit(node: ts.Node) {
				if (ts.isFunctionDeclaration(node) && node.name) {
					const start = sourceFile.getLineAndCharacterOfPosition(
						node.getStart(sourceFile),
					).line;
					const end = sourceFile.getLineAndCharacterOfPosition(node.end).line;
					fileCounts.set(node.name.text, end - start + 1);
				}
				node.forEachChild(visit);
			}

			visit(sourceFile);
			return fileCounts;
		},
	);
	lineCountsByPath.set(path, counts);
	return counts;
}

afterAll(() => {
	let nativeSourceCallCount = 0;
	try {
		nativeSourceCallCount = withNativeSource.mock.calls.length;
	} finally {
		try {
			withNativeSource.mockRestore();
		} finally {
			lineCountsByPath.clear();
		}
	}
	expect(nativeSourceCallCount).toBe(
		new Set(TARGETS.map(([relativePath]) => relativePath)).size,
	);
});

describe("approved settings component boundaries", () => {
	it.each(TARGETS)(
		"keeps every component in %s within 300 AST lines",
		(path, parentName) => {
			const counts = componentLineCounts(path);

			expect(counts.has(parentName)).toBe(true);
			expect(Object.fromEntries(counts)).toEqual(
				Object.fromEntries([...counts].filter(([, lines]) => lines <= 300)),
			);
		},
	);
});
