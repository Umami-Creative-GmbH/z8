import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #1925 Static CI Contract-Boundary Guard
 *
 * Prevents direct reads of work policy child/version/assignment tables, legacy
 * `policy_id` joins on `work_policy_schedule` / `work_policy_presence` /
 * `work_policy_regulation`, legacy `with: { schedule | regulation | presence }`
 * relations on `workPolicy`, and legacy `syncTermsPolicy` / `work_policy.is_default`
 * writes from re-entering application code outside the unified contract boundary.
 *
 * Uses pure directory traversal (`readdirSync({ withFileTypes: true })`) with zero
 * symlinks so it runs identically on Windows, macOS, and Linux CI.
 */

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.resolve(THIS_DIR, "../..");

const DIRECT_POLICY_TABLE_ALLOW_LIST_PREFIXES = [
	"lib/contracts/",
	"lib/work-policy/",
	"db/schema/",
	"db/seed/",
	"test/",
];

const DIRECT_POLICY_TABLE_ALLOW_LIST_FILES = new Set([
	"db/index.ts",
	"lib/locations/location-lifecycle.ts",
	"lib/time-tracking/policy-clock-out-break-snapshot.ts",
	"lib/time-tracking/web-clock-out-resources.ts",
]);

const LEGACY_POLICY_ID_JOIN_ALLOW_LIST_FILES = new Set([
	// Transactional clock-out lock/snapshot files explicitly check `policy_version_id`
	// alongside `policy_id` during the pre-0327 expand/drain window (Time Tracking ADR-0003).
	"lib/time-tracking/policy-clock-out-break-snapshot.ts",
	"lib/time-tracking/web-clock-out-resources.ts",
	// Pre-cutover v1 fallback in the versioned policy writer when sealing is not yet active.
	"lib/work-policy/versioned-policy-writer.ts",
]);

const POLICY_DRIZZLE_TABLE_PATTERN =
	/\bworkPolicy(Schedule|ScheduleDay|Regulation|BreakRule|BreakOption|Presence|Assignment|Version)\b/;

const POLICY_RAW_SQL_READ_PATTERN =
	/\b(?:from|join)\s+"?work_policy_(?:schedule|schedule_day|presence|regulation|assignment|version|break_rule|break_option)"?\b/i;

const POLICY_ID_CHILD_DRIZZLE_PATTERN = /\bworkPolicy(Schedule|Presence|Regulation)\.policyId\b/;

const POLICY_ID_CHILD_RAW_SQL_PATTERN =
	/\b(?:work_policy_(?:schedule|presence|regulation))\b[\s\S]{0,160}\bpolicy_id\s*=/i;

const LEGACY_WORK_POLICY_RELATION_PATTERN =
	/\bWORK_POLICY_DETAILS_WITH\b|\bworkPolicy\.find(?:First|Many)\s*\([\s\S]{0,400}\bwith\s*:\s*\{[\s\S]{0,160}\b(?:schedule|regulation|presence)\s*:/;

const LEGACY_SYNC_TERMS_POLICY_PATTERN = /\b(?:syncTermsPolicy|removeTermsPolicy)\b/;

const LEGACY_IS_DEFAULT_ACCESS_PATTERN = /\bworkPolicy\.isDefault\b/;

function listProductionTsFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "__tests__" || entry.name === "node_modules") continue;
			listProductionTsFiles(fullPath, out);
		} else if (
			/\.(ts|tsx)$/.test(entry.name) &&
			!/\.(test|spec|fixture)\.(ts|tsx)$/.test(entry.name) &&
			!entry.name.endsWith(".d.ts")
		) {
			out.push(fullPath);
		}
	}
	return out;
}

function toRelPosix(fullPath: string): string {
	return path.relative(SRC_ROOT, fullPath).replace(/\\/g, "/");
}

function isAllowedForPolicyTableReads(relPath: string): boolean {
	if (DIRECT_POLICY_TABLE_ALLOW_LIST_FILES.has(relPath)) return true;
	return DIRECT_POLICY_TABLE_ALLOW_LIST_PREFIXES.some((prefix) => relPath.startsWith(prefix));
}

function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

describe("contract-read boundary guard (#1925)", () => {
	const productionFiles = listProductionTsFiles(SRC_ROOT);

	it("discovers production files under apps/webapp/src", () => {
		expect(productionFiles.length).toBeGreaterThan(100);
	});

	it("forbids direct Drizzle or raw-SQL reads of policy/assignment tables outside the allow-list", () => {
		const violations: string[] = [];

		for (const fullPath of productionFiles) {
			const rel = toRelPosix(fullPath);
			if (isAllowedForPolicyTableReads(rel)) continue;

			const code = stripComments(readFileSync(fullPath, "utf8"));
			const lines = code.split(/\r?\n/);

			lines.forEach((line, index) => {
				if (POLICY_DRIZZLE_TABLE_PATTERN.test(line)) {
					violations.push(`${rel}:${index + 1}: direct Drizzle reference -> ${line.trim()}`);
				} else if (POLICY_RAW_SQL_READ_PATTERN.test(line)) {
					violations.push(`${rel}:${index + 1}: direct raw-SQL read -> ${line.trim()}`);
				}
			});
		}

		expect(violations).toEqual([]);
	});

	it("forbids policy_id joins or filters on work_policy_schedule / presence / regulation", () => {
		const violations: string[] = [];

		for (const fullPath of productionFiles) {
			const rel = toRelPosix(fullPath);
			if (
				rel.startsWith("db/schema/") ||
				rel.startsWith("db/seed/") ||
				rel.startsWith("test/") ||
				LEGACY_POLICY_ID_JOIN_ALLOW_LIST_FILES.has(rel)
			) {
				continue;
			}

			const code = stripComments(readFileSync(fullPath, "utf8"));
			const lines = code.split(/\r?\n/);

			lines.forEach((line, index) => {
				if (POLICY_ID_CHILD_DRIZZLE_PATTERN.test(line)) {
					violations.push(
						`${rel}:${index + 1}: legacy child .policyId reference -> ${line.trim()}`,
					);
				}
			});

			if (POLICY_ID_CHILD_RAW_SQL_PATTERN.test(code)) {
				violations.push(`${rel}: raw-SQL policy_id join/filter on policy child table`);
			}
		}

		expect(violations).toEqual([]);
	});

	it("forbids legacy reverse one() schedule/regulation/presence relations on workPolicy", () => {
		const relationsPath = path.join(SRC_ROOT, "db/schema/relations.ts");
		const relationsSource = readFileSync(relationsPath, "utf8");
		const workPolicyRelBlock = relationsSource.match(
			/export const workPolicyRelations = relations\(workPolicy,[\s\S]*?\)\);/,
		);
		expect(workPolicyRelBlock).not.toBeNull();
		expect(workPolicyRelBlock?.[0]).not.toMatch(/\b(?:schedule|regulation|presence)\s*:\s*one\(/);

		const workPolicyVersionRelBlock = relationsSource.match(
			/export const workPolicyVersionRelations = relations\(workPolicyVersion,[\s\S]*?\)\);/,
		);
		expect(workPolicyVersionRelBlock).not.toBeNull();
		expect(workPolicyVersionRelBlock?.[0]).toMatch(/\bschedule\s*:\s*one\(workPolicySchedule\)/);
		expect(workPolicyVersionRelBlock?.[0]).toMatch(
			/\bregulation\s*:\s*one\(workPolicyRegulation\)/,
		);
		expect(workPolicyVersionRelBlock?.[0]).toMatch(/\bpresence\s*:\s*one\(workPolicyPresence\)/);

		const violations: string[] = [];
		for (const fullPath of productionFiles) {
			const rel = toRelPosix(fullPath);
			if (rel.startsWith("db/schema/")) continue;

			const code = stripComments(readFileSync(fullPath, "utf8"));
			if (LEGACY_WORK_POLICY_RELATION_PATTERN.test(code)) {
				violations.push(`${rel}: legacy workPolicy with: { schedule | regulation | presence }`);
			}
		}

		expect(violations).toEqual([]);
	});

	it("forbids legacy syncTermsPolicy callers and direct workPolicy.isDefault reads/writes", () => {
		const violations: string[] = [];

		for (const fullPath of productionFiles) {
			const rel = toRelPosix(fullPath);
			if (rel.startsWith("db/schema/") || rel.startsWith("db/seed/")) continue;

			const code = stripComments(readFileSync(fullPath, "utf8"));
			const lines = code.split(/\r?\n/);

			lines.forEach((line, index) => {
				if (LEGACY_SYNC_TERMS_POLICY_PATTERN.test(line)) {
					violations.push(`${rel}:${index + 1}: legacy syncTermsPolicy caller -> ${line.trim()}`);
				}
				if (LEGACY_IS_DEFAULT_ACCESS_PATTERN.test(line)) {
					violations.push(`${rel}:${index + 1}: deprecated workPolicy.isDefault -> ${line.trim()}`);
				}
			});
		}

		expect(violations).toEqual([]);
	});
});
