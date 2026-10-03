import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Approval authority is answered only by `approvals/authority/` (#474).
 * Anywhere else, comparing a lifecycle mode with a mode literal, or writing a
 * SQL `lifecycle_mode in (…)`, re-derives it by hand.
 */

const SRC_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** Directories (and the cutover transitions) allowed to name lifecycle modes. */
const ALLOWED = [
	"lib/approvals/authority/",
	"lib/approvals/workflow/cutover.ts",
];

const MODE = '"(?:legacy|shadow|ready|canonical|complete)"';
const LIFECYCLE_ONLY = '"(?:shadow|ready|complete)"';
const OPERATOR = String.raw`\s*[!=]==?\s*`;
/** Receivers that always hold a lifecycle mode, whichever literal they meet. */
const MODE_RECEIVER = String.raw`(?:\blifecycleMode|\blifecycle_mode|\b(?:gate|authority|rollout|execution|row)\??\.mode)\b`;
/** Any mode-named receiver: only lifecycle modes are `shadow`, `ready` or `complete`. */
const ANY_MODE = String.raw`[\w?.]*(?:[mM]ode|[lL]ifecycle)\b`;

const FORBIDDEN: Array<{ name: string; pattern: RegExp }> = [
	{
		name: "lifecycle mode compared with a mode literal",
		pattern: new RegExp(`${MODE_RECEIVER}${OPERATOR}${MODE}|${MODE}${OPERATOR}${MODE_RECEIVER}`),
	},
	{
		name: "mode compared with a lifecycle-only literal",
		pattern: new RegExp(
			`${ANY_MODE}${OPERATOR}${LIFECYCLE_ONLY}|${LIFECYCLE_ONLY}${OPERATOR}${ANY_MODE}`,
		),
	},
	{
		name: "hand-written SQL lifecycle_mode condition",
		pattern: /lifecycle_mode\s+(?:not\s+)?in\s*\(|lifecycle_mode\s*(?:=|<>|!=)\s*'/i,
	},
	{
		name: "hand-built set of lifecycle modes",
		pattern: /Set<ApprovalWorkflowLifecycleMode>/,
	},
];

function walk(dir: string, files: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const fullPath = join(dir, entry);
		if (statSync(fullPath).isDirectory()) {
			if (entry === "node_modules" || entry === "__tests__") continue;
			walk(fullPath, files);
		} else if (
			/\.tsx?$/.test(entry) &&
			!/\.(?:test|spec)\.tsx?$/.test(entry) &&
			!entry.endsWith(".d.ts")
		) {
			files.push(fullPath);
		}
	}
	return files;
}

function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function findLifecycleModeComparisons(source: string): Array<{ line: number; rule: string }> {
	const found: Array<{ line: number; rule: string }> = [];
	stripComments(source)
		.split("\n")
		.forEach((text, index) => {
			for (const { name, pattern } of FORBIDDEN) {
				if (pattern.test(text)) found.push({ line: index + 1, rule: name });
			}
		});
	return found;
}

describe("approval authority source guard", () => {
	it.each([
		['if (gate.mode === "legacy" || gate.mode === "shadow") {', true],
		['const canonical = rollout?.mode === "canonical" || rollout?.mode === "complete";', true],
		['if (input.authorityMode === "complete") return;', true],
		['if (lifecycleMode === "canonical") return "canonical";', true],
		["and (r.lifecycle_mode is null or r.lifecycle_mode not in ('canonical', 'complete'))", true],
		["join approval_workflow_rollout r on r.lifecycle_mode in ('canonical', 'complete')", true],
		["const MODES = new Set<ApprovalWorkflowLifecycleMode>([", true],
		['return row?.mode === "canonical";', true],
		['if (gate.authority === "legacy") {', false],
		['if (evidence.mode === "canonical") {', false],
		['if (event.authority_mode === "legacy") {', false],
		['if (step.status === "complete") {', false],
		['.where(approvalAuthoritySql(sql`r.lifecycle_mode`, "legacy"))', false],
	] as const)("classifies %s", (line, forbidden) => {
		expect(findLifecycleModeComparisons(line).length > 0).toBe(forbidden);
	});

	it("keeps lifecycle mode comparisons inside the authority module", () => {
		const offenders: string[] = [];
		for (const file of walk(SRC_ROOT)) {
			const path = relative(SRC_ROOT, file).split(sep).join("/");
			if (ALLOWED.some((allowed) => path.startsWith(allowed))) continue;
			for (const { line, rule } of findLifecycleModeComparisons(readFileSync(file, "utf8"))) {
				offenders.push(`src/${path}:${line} ${rule}`);
			}
		}
		expect(offenders).toEqual([]);
	});
});
