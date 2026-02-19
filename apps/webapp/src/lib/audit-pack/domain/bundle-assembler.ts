import JSZip from "jszip";
import type {
	ApprovalEvidence,
	AuditTimelineEvent,
	CorrectionLinkNode,
	EntryChainEvidence,
} from "./types";

const FORMULA_PREFIX_PATTERN = /^[\t\r\n ]*[=+\-@]/;
const ZIP_ENTRY_DATE = new Date("1980-01-01T00:00:00.000Z");

export interface AuditPackAssembleInput {
	entries: readonly EntryChainEvidence[];
	corrections: readonly CorrectionLinkNode[];
	approvals: readonly ApprovalEvidence[];
	timeline: readonly AuditTimelineEvent[];
	scope: Record<string, unknown>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeForStableSerialization(value: unknown): unknown {
	if (Array.isArray(value)) {
		const normalized = value.map((item) => normalizeForStableSerialization(item));
		return normalized.sort((a, b) =>
			JSON.stringify(a, null, 0).localeCompare(JSON.stringify(b, null, 0)),
		);
	}

	if (isPlainObject(value)) {
		const normalizedObject: Record<string, unknown> = {};
		for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) {
			normalizedObject[key] = normalizeForStableSerialization(value[key]);
		}
		return normalizedObject;
	}

	return value;
}

function stableJson(value: unknown): string {
	return `${JSON.stringify(normalizeForStableSerialization(value), null, 2)}\n`;
}

function escapeCsvCell(value: unknown): string {
	const raw = value == null ? "" : String(value);
	const safe = FORMULA_PREFIX_PATTERN.test(raw) ? `'${raw}` : raw;
	return `"${safe.replaceAll('"', '""')}"`;
}

function buildCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
	const headerLine = headers.map((header) => escapeCsvCell(header)).join(",");
	const lines = rows.map((row) => row.map((cell) => escapeCsvCell(cell)).join(","));
	return `${[headerLine, ...lines].join("\n")}\n`;
}

function toEntriesCsv(entries: readonly EntryChainEvidence[]): string {
	const sortedEntries = [...entries].sort((a, b) => a.id.localeCompare(b.id));
	return buildCsv(
		[
			"id",
			"organizationId",
			"occurredAt",
			"previousEntryId",
			"replacesEntryId",
			"supersededById",
		],
		sortedEntries.map((entry) => [
			entry.id,
			entry.organizationId,
			entry.occurredAt,
			entry.lineage.previousEntryId,
			entry.lineage.replacesEntryId,
			entry.lineage.supersededById,
		]),
	);
}

function toApprovalsCsv(approvals: readonly ApprovalEvidence[]): string {
	const sortedApprovals = [...approvals].sort((a, b) => a.id.localeCompare(b.id));
	return buildCsv(
		["id", "organizationId", "entryId", "approvedAt", "status", "approvedById"],
		sortedApprovals.map((approval) => [
			approval.id,
			approval.organizationId,
			approval.entryId,
			approval.approvedAt,
			approval.status,
			approval.approvedById,
		]),
	);
}

export async function assembleAuditPackZip(input: AuditPackAssembleInput): Promise<Buffer> {
	const zip = new JSZip();

	const files = [
		{ path: "evidence/entries.json", content: stableJson(input.entries) },
		{ path: "evidence/corrections.json", content: stableJson(input.corrections) },
		{ path: "evidence/approvals.json", content: stableJson(input.approvals) },
		{ path: "evidence/audit-timeline.json", content: stableJson(input.timeline) },
		{ path: "meta/scope.json", content: stableJson(input.scope) },
		{ path: "views/entries.csv", content: toEntriesCsv(input.entries) },
		{ path: "views/approvals.csv", content: toApprovalsCsv(input.approvals) },
	].sort((a, b) => a.path.localeCompare(b.path));

	for (const file of files) {
		zip.file(file.path, file.content, {
			date: ZIP_ENTRY_DATE,
			compression: "DEFLATE",
			compressionOptions: { level: 9 },
		});
	}

	return zip.generateAsync({
		type: "nodebuffer",
		compression: "DEFLATE",
		compressionOptions: { level: 9 },
		platform: "DOS",
	});
}
