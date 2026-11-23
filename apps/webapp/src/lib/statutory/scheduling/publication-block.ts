/**
 * The shift-publish gate for statutory findings (#1993). While an organization blocks JArbSchG
 * shift publication, a youth-protection hard-limit finding on a planned shift arrives with
 * `blocksPublication` (lifted by a current sector-exception acknowledgement), and publishing the
 * range is refused, whatever the planner acknowledged in the publish dialog. Clock-in and
 * clock-out are never blocked.
 */
import type {
	ComplianceFinding,
	StatutoryComplianceFinding,
} from "@/lib/scheduling/compliance/types";

export const STATUTORY_PUBLICATION_BLOCKED = "statutory_publication_blocked";

export function publicationBlockingFindings(
	findings: readonly ComplianceFinding[],
): StatutoryComplianceFinding[] {
	return findings.filter(
		(finding): finding is StatutoryComplianceFinding =>
			finding.type === "statutory" && finding.blocksPublication,
	);
}

/** The refusal message, or null when publication may proceed. */
export function statutoryPublicationRefusal(findings: readonly ComplianceFinding[]): string | null {
	const blocking = publicationBlockingFindings(findings);
	if (blocking.length === 0) return null;
	const employees = new Set(blocking.map((finding) => finding.employeeId)).size;
	return `Cannot publish: ${blocking.length} shift finding(s) for ${employees} employee(s) break youth protection limits (JArbSchG). Change the shifts or acknowledge a statutory sector exception before publishing.`;
}

/** The refusal message of a published shift's edit that the publish block refuses. */
export const STATUTORY_SHIFT_EDIT_REFUSAL_MESSAGE =
	"Cannot save: this change to a published shift breaks youth protection limits (JArbSchG). Change the shift or acknowledge a statutory sector exception first.";
