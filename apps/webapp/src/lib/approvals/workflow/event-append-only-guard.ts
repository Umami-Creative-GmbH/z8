import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	type ApprovalWorkflowEventMutationViolation,
	analyzeApprovalWorkflowEventMutations,
} from "./event-append-only-typescript";

export type { ApprovalWorkflowEventMutationViolation } from "./event-append-only-typescript";

export function findApprovalWorkflowEventMutationViolations(
	source: string,
	fileName: string,
): ApprovalWorkflowEventMutationViolation[] {
	return analyzeApprovalWorkflowEventMutations(source, fileName);
}

const TYPESCRIPT_SOURCE = /\.(?:ts|tsx|mts|cts)$/;
const TEST_SOURCE = /\.(?:test|spec)\.[cm]?tsx?$/;
const PREFILTER = /approvalWorkflowEvent|approval_workflow_|workflow_event/i;

function compareAscii(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function hasPrefilterCandidate(source: string): boolean {
	if (PREFILTER.test(source)) return true;
	const normalized = source.toLowerCase();
	return (
		normalized.includes("approval") &&
		normalized.includes("workflow") &&
		normalized.includes("event")
	);
}

function isExcludedProductionPath(fileName: string): boolean {
	const normalized = fileName.replaceAll("\\", "/");
	return (
		/(?:^|\/)__tests__(?:\/|$)/.test(normalized) ||
		TEST_SOURCE.test(normalized) ||
		/(?:^|\/)apps\/webapp\/drizzle(?:\/|$)/.test(normalized) ||
		/(?:^|\/)apps\/webapp\/src\/db\/auth-schema\.ts$/.test(normalized)
	);
}

export function scanProductionApprovalWorkflowEventMutations(
	roots: string | readonly string[],
): ApprovalWorkflowEventMutationViolation[] {
	const files = new Set<string>();
	const walk = (directory: string): void => {
		for (const entry of readdirSync(directory).sort(compareAscii)) {
			const path = join(directory, entry);
			if (isExcludedProductionPath(path)) continue;
			const stat = lstatSync(path);
			if (stat.isSymbolicLink()) continue;
			if (stat.isDirectory()) walk(path);
			else if (TYPESCRIPT_SOURCE.test(path)) files.add(path);
		}
	};
	const resolvedRoots = [
		...new Set(
			(typeof roots === "string" ? [roots] : roots).map((root) =>
				resolve(root),
			),
		),
	].sort(compareAscii);
	for (const root of resolvedRoots) {
		if (!lstatSync(root).isSymbolicLink()) walk(root);
	}
	const violations = [...files].sort(compareAscii).flatMap((fileName) => {
		const source = readFileSync(fileName, "utf8");
		return hasPrefilterCandidate(source)
			? findApprovalWorkflowEventMutationViolations(source, fileName)
			: [];
	});
	const unique = new Map<string, ApprovalWorkflowEventMutationViolation>();
	for (const violation of violations) {
		unique.set(
			`${violation.fileName}\0${violation.line}\0${violation.column}\0${violation.kind}`,
			violation,
		);
	}
	return [...unique.values()].sort(
		(left, right) =>
			compareAscii(left.fileName, right.fileName) ||
			left.line - right.line ||
			left.column - right.column ||
			compareAscii(left.kind, right.kind),
	);
}
