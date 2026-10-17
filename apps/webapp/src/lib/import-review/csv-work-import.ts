import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { member, user } from "@/db/auth-schema";
import {
	auditLog,
	completedWorkOperation,
	employee,
	importBatch,
	importBatchJob,
	importIssue,
	importStagedRow,
	organizationVehicle,
	workPeriod,
} from "@/db/schema";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import {
	dateFromInstant,
	parseInstant,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { personnelNumberKey } from "@/lib/organization/personnel-number";
import { personnelNumberKeySql } from "@/lib/organization/personnel-number-uniqueness";
import { licencePlateKey } from "@/lib/organization/vehicles/vehicle-rules";
import { canonicalJson } from "@/lib/time-tracking/canonical-json";
import {
	interpretImportedWorkInterval,
	NO_PROVIDER_EVIDENCE,
} from "@/lib/time-tracking/imported-work-interval";
import {
	createImportedCompletedWork,
	importedWorkSourceKey,
} from "@/lib/time-tracking/record-imported-work";
import {
	drivingDetailsExpectedSince,
	isDrivingDetailsMissing,
} from "@/lib/time-tracking/vehicle-use/driving-details-missing";
import { loadDrivingDetailsConfiguration } from "@/lib/time-tracking/vehicle-use/driving-details-missing-store";
import { checkWorkVehicleUsePlausibility } from "@/lib/time-tracking/vehicle-use/plausibility-check";
import {
	sameWorkVehicleUse,
	vehicleUseFromColumns,
	vehicleUseIdentity,
	type WorkVehicleUse,
} from "@/lib/time-tracking/vehicle-use/work-vehicle-use";
import { assertWorkVehicleUseChangeAllowed } from "@/lib/time-tracking/vehicle-use/work-vehicle-use-eligibility";
import { loadWorkOccupants } from "@/lib/time-tracking/work-occupancy";
import { readWorkRecord } from "@/lib/time-tracking/work-records";
import type { WorkTransactionClient } from "@/lib/time-tracking/work-transaction";
import { parseCsvWorkRecord, parseCsvWorkUpload } from "./csv-work-format";
import { withReviewedImportTransaction } from "./import-work-transaction";
import { applyImportRowDecision } from "./repository";
import type {
	CsvWorkScanJobData,
	ImportCommitJobData,
	ImportIssueType,
} from "./types";

export interface CsvWorkActor {
	organizationId: string;
	actorUserId: string;
}
export interface CsvWorkBatchActor extends CsvWorkActor {
	batchId: string;
}
type Reader = WorkTransactionClient;
const CSV_RULE_VERSION = "csv-work-v1";
class CsvReviewError extends Error {
	constructor(
		readonly issueType: ImportIssueType,
		message: string,
	) {
		super(message);
	}
}
const hash = (value: unknown) =>
	createHash("sha256").update(canonicalJson(value)).digest("hex");
const batchWhere = (input: { organizationId: string; batchId: string }) =>
	and(
		eq(importBatch.id, input.batchId),
		eq(importBatch.organizationId, input.organizationId),
		eq(importBatch.provider, "csv"),
	);
const rowWhere = (input: { organizationId: string; batchId: string }) =>
	and(
		eq(importStagedRow.batchId, input.batchId),
		eq(importStagedRow.organizationId, input.organizationId),
	);

/** Also used by the worker under the importer's work-transaction guards. */
async function assertCsvAdmin(reader: Reader, input: CsvWorkActor) {
	const [membership] = await reader
		.select({ role: member.role })
		.from(member)
		.where(
			and(
				eq(member.organizationId, input.organizationId),
				eq(member.userId, input.actorUserId),
				eq(member.status, "approved"),
			),
		)
		.limit(1);
	const [actor] = await reader
		.select({ active: employee.isActive })
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				eq(employee.userId, input.actorUserId),
			),
		)
		.limit(1);
	if (
		!membership ||
		(!hasOrganizationRole(membership.role, "admin") &&
			!hasOrganizationRole(membership.role, "owner")) ||
		actor?.active === false
	)
		throw new Error(
			"Only active approved organization admins can manage CSV work imports",
		);
}
async function readBatch(
	reader: Reader,
	input: { organizationId: string; batchId: string },
	lock = false,
) {
	const query = reader
		.select()
		.from(importBatch)
		.where(batchWhere(input))
		.limit(1);
	const [batch] = await (lock ? query.for("update") : query);
	if (!batch) throw new Error("CSV work import not found in this organization");
	return batch;
}
function sourceValues(source: Record<string, unknown>): Record<string, string> {
	const values = source.values;
	if (
		!values ||
		typeof values !== "object" ||
		Array.isArray(values) ||
		Object.values(values).some((value) => typeof value !== "string")
	)
		throw new Error("Invalid retained CSV source");
	return values as Record<string, string>;
}
function fileTimezone(batch: typeof importBatch.$inferSelect) {
	return typeof batch.selectedScope.timezone === "string"
		? batch.selectedScope.timezone
		: undefined;
}

/** Upload evidence is durable before its credential-free scan job is queued. */
export async function createCsvWorkImport(
	input: CsvWorkActor & { csv: string; timezone?: string; fileName: string },
) {
	await assertCsvAdmin(db, input);
	const upload = parseCsvWorkUpload(input.csv, input.timezone);
	const today = systemClock.nowInstant().toString().slice(0, 10);
	const dates = upload.rows
		.flatMap((row) =>
			row.normalized
				? [
						row.source.starts_at.trim().slice(0, 10),
						row.source.ends_at.trim().slice(0, 10),
					]
				: [],
		)
		.sort();
	return db.transaction(async (tx) => {
		const [batch] = await tx
			.insert(importBatch)
			.values({
				organizationId: input.organizationId,
				provider: "csv",
				status: "scanning",
				selectedScope: {
					fileName: input.fileName.slice(0, 200),
					timezone: upload.timezone,
				},
				dateRange: {
					startDate: dates[0] ?? today,
					endDate: dates.at(-1) ?? today,
				},
				totalRows: upload.rows.length,
				startedBy: input.actorUserId,
			})
			.returning();
		for (const chunk of Array.from(
			{ length: Math.ceil(upload.rows.length / 100) },
			(_, index) => upload.rows.slice(index * 100, index * 100 + 100),
		)) {
			await tx.insert(importStagedRow).values(
				chunk.map((row) => ({
					batchId: batch.id,
					organizationId: input.organizationId,
					entityType: "work_period",
					providerSourceId: hash(row.source),
					sourcePayloadHash: hash({
						rowNumber: row.rowNumber,
						values: row.source,
					}),
					sourcePayload: { rowNumber: row.rowNumber, values: row.source },
					normalizedPayload: {},
					rowStatus: "staged" as const,
				})),
			);
		}
		const [job] = await tx
			.insert(importBatchJob)
			.values({
				batchId: batch.id,
				organizationId: input.organizationId,
				kind: "scan",
				entityType: "work_period",
				partitionKey: "csv-upload",
			})
			.returning();
		const scanJob: CsvWorkScanJobData = {
			type: "import-review-scan",
			provider: "csv",
			batchId: batch.id,
			jobId: job.id,
			organizationId: input.organizationId,
			entityType: "work_period",
		};
		return { batchId: batch.id, scanJob };
	});
}

function mappedTarget(
	batch: typeof importBatch.$inferSelect,
	kind: "employee" | "vehicle",
	key: string,
): string | null {
	const mappings =
		batch.selectedScope[
			kind === "employee" ? "employeeMappings" : "vehicleMappings"
		];
	if (
		!mappings ||
		typeof mappings !== "object" ||
		Array.isArray(mappings) ||
		!Object.hasOwn(mappings, key)
	)
		return null;
	const value = (mappings as Record<string, unknown>)[key];
	return typeof value === "string" ? value : null;
}

/** Resolves source evidence against current, organization-scoped master data. */
async function resolveCsvRecord(
	reader: Reader,
	batch: typeof importBatch.$inferSelect,
	values: Record<string, string>,
) {
	const record = parseCsvWorkRecord(values, fileTimezone(batch));
	const interval = interpretImportedWorkInterval({
		startsAt: record.start.at,
		endsAt: record.end.at,
		evidence: NO_PROVIDER_EVIDENCE,
		now: systemClock.nowInstant(),
	});
	if (interval.kind === "held")
		throw new CsvReviewError(
			"validation_error",
			interval.hold.reason === "invalid_interval" &&
				interval.hold.detail === "future_endpoint"
				? "Completed work cannot contain future timestamps"
				: "This completed-work interval is not eligible for import",
		);
	const employeeMapping = mappedTarget(
		batch,
		"employee",
		personnelNumberKey(record.personnelNumber) ?? "",
	);
	const people = await reader
		.select({ id: employee.id, teamId: employee.teamId })
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, batch.organizationId),
				employeeMapping
					? eq(employee.id, employeeMapping)
					: sql`${personnelNumberKeySql(employee.employeeNumber)} = ${personnelNumberKeySql(sql`${record.personnelNumber}::text`)}`,
			),
		)
		.limit(2);
	if (people.length !== 1)
		throw new CsvReviewError(
			"unmatched_employee",
			"No unambiguous employee matches this personnel number; map an existing employee or reject the row",
		);
	const person = people[0];
	let use: WorkVehicleUse | null = null;
	if (record.vehicle) {
		if (record.vehicle.vehicle.kind === "own")
			use = { ...record.vehicle, vehicle: { kind: "own" } };
		else {
			const key = licencePlateKey(record.vehicle.vehicle.licencePlate);
			const mapping = mappedTarget(batch, "vehicle", key);
			const [vehicle] = await reader
				.select({
					id: organizationVehicle.id,
					archivedAt: organizationVehicle.archivedAt,
				})
				.from(organizationVehicle)
				.where(
					and(
						eq(organizationVehicle.organizationId, batch.organizationId),
						mapping
							? eq(organizationVehicle.id, mapping)
							: eq(organizationVehicle.licencePlateKey, key),
					),
				)
				.limit(1);
			if (!vehicle)
				throw new CsvReviewError(
					"unmatched_vehicle",
					"Unknown licence plate; map an existing organization vehicle or reject the row",
				);
			if (vehicle.archivedAt)
				throw new Error(
					"The vehicle is archived and cannot be imported as a new vehicle choice",
				);
			use = {
				...record.vehicle,
				vehicle: { kind: "organization", vehicleId: vehicle.id },
			};
		}
		await assertWorkVehicleUseChangeAllowed(reader, {
			organizationId: batch.organizationId,
			employeeId: person.id,
			previous: null,
			resulting: use,
		});
	}
	const start = parseInstant(record.start.at),
		end = parseInstant(record.end.at);
	const warnings: { code: string; [key: string]: unknown }[] = use
		? await checkWorkVehicleUsePlausibility(reader, {
				organizationId: batch.organizationId,
				employeeId: person.id,
				use,
				start,
				end,
			})
		: [];
	const configuration = await loadDrivingDetailsConfiguration(
		reader,
		batch.organizationId,
	);
	if (
		isDrivingDetailsMissing(
			{ startedAt: start, endedAt: end, vehicleUse: use },
			drivingDetailsExpectedSince(
				{ employeeId: person.id, teamId: person.teamId },
				configuration,
			),
		)
	)
		warnings.push({ code: "driving_details_missing" });
	return { record, employeeId: person.id, vehicleUse: use, warnings };
}

/** Resolved work identity is independent of upload names, row order and source spelling. */
function csvWorkIdentity(
	resolved: Awaited<ReturnType<typeof resolveCsvRecord>>,
) {
	return canonicalJson([
		resolved.employeeId,
		resolved.record.start.at,
		resolved.record.end.at,
		vehicleUseIdentity(resolved.vehicleUse),
	]);
}

async function csvWorkOccupancy(
	reader: Reader,
	batch: typeof importBatch.$inferSelect,
	resolved: Awaited<ReturnType<typeof resolveCsvRecord>>,
) {
	const { record, employeeId } = resolved;
	const occupants = await loadWorkOccupants(reader, {
		organizationId: batch.organizationId,
		employeeId,
		interval: {
			startAt: parseInstant(record.start.at),
			endAt: parseInstant(record.end.at),
		},
		excludeWorkPeriodIds: [],
	});
	if (!occupants.length) return { kind: "empty" as const };
	if (occupants.length === 1 && occupants[0].kind === "work_period") {
		const [existing] = await reader
			.select()
			.from(workPeriod)
			.where(
				and(
					eq(workPeriod.organizationId, batch.organizationId),
					eq(workPeriod.employeeId, employeeId),
					eq(workPeriod.id, occupants[0].id),
				),
			)
			.limit(1);
		if (
			existing &&
			existing.endTime !== null &&
			existing.startTime.getTime() ===
				dateFromInstant(parseInstant(record.start.at)).getTime() &&
			existing.endTime.getTime() ===
				dateFromInstant(parseInstant(record.end.at)).getTime() &&
			sameWorkVehicleUse(vehicleUseFromColumns(existing), resolved.vehicleUse)
		)
			return { kind: "duplicate" as const, workPeriodId: existing.id };
	}
	return { kind: "conflict" as const };
}

async function normalizeCsvBatch(
	reader: Reader,
	batch: typeof importBatch.$inferSelect,
) {
	const input = { organizationId: batch.organizationId, batchId: batch.id };
	const rows = await reader
		.select()
		.from(importStagedRow)
		.where(rowWhere(input))
		.orderBy(sql`(${importStagedRow.sourcePayload}->>'rowNumber')::int`);
	let issues = 0;
	const seen = new Set<string>();
	const intervals: {
		employeeId: string;
		start: bigint;
		end: bigint;
		identity: string;
	}[] = [];
	for (const row of rows) {
		if (row.rowStatus === "committed" || row.rowStatus === "rejected") continue;
		await reader
			.delete(importIssue)
			.where(
				and(
					eq(importIssue.organizationId, input.organizationId),
					eq(importIssue.batchId, input.batchId),
					eq(importIssue.stagedRowId, row.id),
					eq(importIssue.detectionRuleVersion, CSV_RULE_VERSION),
				),
			);
		try {
			const resolved = await resolveCsvRecord(
				reader,
				batch,
				sourceValues(row.sourcePayload),
			);
			const occupancy = await csvWorkOccupancy(reader, batch, resolved);
			if (occupancy.kind === "conflict")
				throw new Error(
					"The row overlaps existing work or conflicts with its vehicle details; imports never overwrite work",
				);
			const identity = csvWorkIdentity(resolved);
			const start = parseInstant(resolved.record.start.at).epochNanoseconds,
				end = parseInstant(resolved.record.end.at).epochNanoseconds;
			if (
				intervals.some(
					(other) =>
						other.employeeId === resolved.employeeId &&
						start < other.end &&
						end > other.start &&
						other.identity !== identity,
				)
			)
				throw new Error(
					"This row overlaps another row in the upload; reject the conflicting row and recheck",
				);
			intervals.push({ employeeId: resolved.employeeId, start, end, identity });
			if (occupancy.kind === "duplicate" || seen.has(identity))
				resolved.warnings.push({ code: "duplicate_will_skip" });
			seen.add(identity);
			if (resolved.warnings.length) {
				issues += resolved.warnings.length;
				await reader
					.insert(importIssue)
					.values(
						resolved.warnings.map((warning) => ({
							organizationId: input.organizationId,
							batchId: input.batchId,
							stagedRowId: row.id,
							issueType:
								warning.code === "duplicate_will_skip"
									? ("duplicate" as const)
									: ("validation_error" as const),
							severity: "warning" as const,
							clusterKey: `${row.id}:${warning.code}`,
							message: warning.code.replaceAll("_", " "),
							details: warning,
							detectionRuleVersion: CSV_RULE_VERSION,
						})),
					)
					.onConflictDoNothing();
			}
			await reader
				.update(importStagedRow)
				.set({
					providerSourceId: hash(identity),
					normalizedPayload: {
						...resolved.record,
						employeeId: resolved.employeeId,
						startsAt: resolved.record.start.at,
						endsAt: resolved.record.end.at,
						vehicleUse: resolved.vehicleUse,
						warnings: resolved.warnings,
					},
					rowStatus: "staged",
					issueSeverity: resolved.warnings.length ? "warning" : "none",
					commitHold: null,
					commitError: null,
					decidedBy: null,
					decidedAt: null,
				})
				.where(and(rowWhere(input), eq(importStagedRow.id, row.id)));
		} catch (error) {
			issues++;
			await reader
				.insert(importIssue)
				.values({
					organizationId: input.organizationId,
					batchId: input.batchId,
					stagedRowId: row.id,
					issueType:
						error instanceof CsvReviewError
							? error.issueType
							: "validation_error",
					severity: "blocking",
					clusterKey: `${row.id}:validation`,
					message:
						error instanceof Error ? error.message : "Invalid source row",
					details: {},
					detectionRuleVersion: CSV_RULE_VERSION,
				})
				.onConflictDoNothing();
			await reader
				.update(importStagedRow)
				.set({
					normalizedPayload: {},
					rowStatus: "needs_mapping",
					issueSeverity: "blocking",
					commitHold: null,
					commitError:
						error instanceof Error ? error.message : "Invalid source row",
					decidedBy: null,
					decidedAt: null,
				})
				.where(and(rowWhere(input), eq(importStagedRow.id, row.id)));
		}
	}
	await reader
		.update(importBatch)
		.set({ issueCount: issues, processedRows: rows.length })
		.where(batchWhere(input));
	return { stagedRows: rows.length, issues };
}

export async function scanCsvWorkImport(job: CsvWorkScanJobData) {
	return db.transaction(async (tx) => {
		const batch = await readBatch(tx, job, true);
		await assertCsvAdmin(tx, {
			organizationId: job.organizationId,
			actorUserId: batch.startedBy,
		});
		if (batch.status !== "scanning")
			return { stagedRows: batch.totalRows, issues: batch.issueCount };
		return normalizeCsvBatch(tx, batch);
	});
}

/** A mapping is a reviewed, audited choice for this batch only; raw CSV stays untouched. */
export async function mapCsvWorkValue(
	input: CsvWorkBatchActor & {
		kind: "employee" | "vehicle";
		sourceValue: string;
		targetId: string;
	},
) {
	await assertCsvAdmin(db, input);
	if (
		!/^[0-9a-f-]{36}$/i.test(input.targetId) ||
		!input.sourceValue.trim() ||
		input.sourceValue.length > 128
	)
		throw new Error("Invalid mapping source or target");
	return db.transaction(async (tx) => {
		const batch = await readBatch(tx, input, true);
		if (batch.status !== "needs_review")
			throw new Error(
				"Mappings can change only while this batch is being reviewed",
			);
		const key =
			input.kind === "employee"
				? personnelNumberKey(input.sourceValue)
				: licencePlateKey(input.sourceValue);
		if (!key) throw new Error("A mapping source is required");
		const sourceRows = await tx
			.select({ source: importStagedRow.sourcePayload })
			.from(importStagedRow)
			.where(rowWhere(input));
		if (
			!sourceRows.some(({ source }) => {
				const values = sourceValues(source);
				return input.kind === "employee"
					? personnelNumberKey(values.personnel_number) === key
					: licencePlateKey(values.licence_plate ?? "") === key;
			})
		)
			throw new Error("This mapping source does not occur in the batch");
		const [target] =
			input.kind === "employee"
				? await tx
						.select({ id: employee.id })
						.from(employee)
						.where(
							and(
								eq(employee.id, input.targetId),
								eq(employee.organizationId, input.organizationId),
							),
						)
						.limit(1)
				: await tx
						.select({ id: organizationVehicle.id })
						.from(organizationVehicle)
						.where(
							and(
								eq(organizationVehicle.id, input.targetId),
								eq(organizationVehicle.organizationId, input.organizationId),
								sql`${organizationVehicle.archivedAt} IS NULL`,
							),
						)
						.limit(1);
		if (!target)
			throw new Error(
				"The mapping target is not eligible in this organization",
			);
		const name =
			input.kind === "employee" ? "employeeMappings" : "vehicleMappings";
		const previous = batch.selectedScope[name];
		const mappings =
			previous && typeof previous === "object" && !Array.isArray(previous)
				? previous
				: {};
		const selectedScope = {
			...batch.selectedScope,
			[name]: { ...mappings, [key]: target.id },
		};
		await tx
			.update(importBatch)
			.set({ selectedScope, reviewedBy: input.actorUserId })
			.where(batchWhere(input));
		await tx.insert(auditLog).values({
			organizationId: input.organizationId,
			entityType: "import_batch",
			entityId: input.batchId,
			action: "import_csv_mapping_changed",
			performedBy: input.actorUserId,
			changes: JSON.stringify({
				kind: input.kind,
				sourceValue: input.sourceValue,
				targetId: target.id,
			}),
		});
		return normalizeCsvBatch(tx, { ...batch, selectedScope });
	});
}

export async function refreshCsvWorkImport(input: CsvWorkBatchActor) {
	await assertCsvAdmin(db, input);
	return db.transaction(async (tx) => {
		const batch = await readBatch(tx, input, true);
		if (
			!["needs_review", "commit_failed", "scan_failed"].includes(batch.status)
		)
			throw new Error(
				"Only a batch in review or a failed attempt can be checked again",
			);
		const result = await normalizeCsvBatch(tx, batch);
		await tx
			.update(importBatch)
			.set({ status: "needs_review", errorMessage: null })
			.where(batchWhere(input));
		return result;
	});
}

export async function getCsvWorkReview(input: CsvWorkBatchActor) {
	await assertCsvAdmin(db, input);
	const batch = await readBatch(db, input);
	const rows = await db
		.select()
		.from(importStagedRow)
		.where(rowWhere(input))
		.orderBy(
			sql`(${importStagedRow.sourcePayload}->>'rowNumber')::int`,
			asc(importStagedRow.id),
		);
	const [people, vehicles] = await Promise.all([
		db
			.select({
				id: employee.id,
				number: employee.employeeNumber,
				name: user.name,
			})
			.from(employee)
			.innerJoin(user, eq(user.id, employee.userId))
			.where(eq(employee.organizationId, input.organizationId))
			.orderBy(asc(user.name)),
		db
			.select({
				id: organizationVehicle.id,
				name: organizationVehicle.name,
				licencePlate: organizationVehicle.licencePlate,
			})
			.from(organizationVehicle)
			.where(
				and(
					eq(organizationVehicle.organizationId, input.organizationId),
					sql`${organizationVehicle.archivedAt} IS NULL`,
				),
			)
			.orderBy(asc(organizationVehicle.name)),
	]);
	const issues = await db
		.select()
		.from(importIssue)
		.where(
			and(
				eq(importIssue.organizationId, input.organizationId),
				eq(importIssue.batchId, input.batchId),
			),
		)
		.orderBy(asc(importIssue.createdAt));
	const imported = rows.filter((row) => row.rowStatus === "committed").length;
	const skipped = rows.filter(
		(row) => row.decisionReason === "duplicate",
	).length;
	const rejected = rows.filter(
		(row) => row.rowStatus === "rejected" && row.decisionReason !== "duplicate",
	).length;
	return {
		batch,
		rows,
		people,
		vehicles,
		issues,
		summary: {
			total: rows.length,
			imported,
			skipped,
			rejected,
			unresolved: rows.length - imported - skipped - rejected,
			accepted: rows.filter((row) => row.rowStatus === "accepted").length,
		},
	};
}
export async function decideCsvWorkRows(
	input: CsvWorkBatchActor & {
		rowIds: string[];
		decision: "accepted" | "rejected";
	},
) {
	await assertCsvAdmin(db, input);
	await readBatch(db, input);
	if (!input.rowIds.length || input.rowIds.length > 1000)
		throw new Error("Choose between 1 and 1000 rows");
	return applyImportRowDecision({ ...input, decidedBy: input.actorUserId });
}
export async function prepareCsvWorkCommit(
	input: CsvWorkBatchActor,
): Promise<ImportCommitJobData> {
	await assertCsvAdmin(db, input);
	return db.transaction(async (tx) => {
		const batch = await readBatch(tx, input, true);
		if (batch.status !== "needs_review")
			throw new Error("This batch is not ready to commit");
		const [accepted] = await tx
			.select({ id: importStagedRow.id })
			.from(importStagedRow)
			.where(and(rowWhere(input), eq(importStagedRow.rowStatus, "accepted")))
			.limit(1);
		if (!accepted) throw new Error("Accept valid rows before committing");
		const [job] = await tx
			.insert(importBatchJob)
			.values({
				batchId: input.batchId,
				organizationId: input.organizationId,
				kind: "commit",
				entityType: "work_period",
				partitionKey: `csv-commit:${randomUUID()}`,
			})
			.returning();
		await tx
			.update(importBatch)
			.set({
				status: "committing",
				committedBy: input.actorUserId,
				selectedScope: { ...batch.selectedScope, commitJobId: job.id },
				errorMessage: null,
			})
			.where(batchWhere(input));
		return {
			type: "import-review-commit",
			batchId: input.batchId,
			jobId: job.id,
			organizationId: input.organizationId,
			entityType: "work_period",
			committedBy: input.actorUserId,
		};
	});
}

type CsvCommitOutcome =
	| { status: "committed" | "skipped" }
	| { status: "held"; message: string };

async function holdCsvRow(
	reader: Reader,
	rowId: string,
	job: ImportCommitJobData,
	message: string,
	hold?: Record<string, unknown>,
): Promise<CsvCommitOutcome> {
	await reader
		.update(importStagedRow)
		.set({
			rowStatus: "blocked",
			issueSeverity: "blocking",
			commitError: message,
			commitHold: hold ?? { reason: "validation_changed" },
		})
		.where(and(rowWhere(job), eq(importStagedRow.id, rowId)));
	const inserted = await reader
		.insert(importIssue)
		.values({
			organizationId: job.organizationId,
			batchId: job.batchId,
			stagedRowId: rowId,
			issueType: "validation_error",
			severity: "blocking",
			clusterKey: `${rowId}:commit`,
			message,
			details: hold ?? {},
			detectionRuleVersion: CSV_RULE_VERSION,
		})
		.onConflictDoNothing()
		.returning({ id: importIssue.id });
	if (inserted.length)
		await reader
			.update(importBatch)
			.set({ issueCount: sql`${importBatch.issueCount} + 1` })
			.where(batchWhere(job));
	return { status: "held", message };
}

/** One CSV row and its receipt are written in the existing reviewed-import work transaction. */
export async function commitCsvWorkRow(
	rowId: string,
	job: ImportCommitJobData,
): Promise<CsvCommitOutcome> {
	return withReviewedImportTransaction(
		{ ...job, rowId, provider: "csv", importerUserId: job.committedBy },
		async (scope) => {
			await assertCsvAdmin(scope.db, {
				organizationId: job.organizationId,
				actorUserId: job.committedBy,
			});
			const [row] = await scope.db
				.select()
				.from(importStagedRow)
				.where(and(rowWhere(job), eq(importStagedRow.id, rowId)))
				.for("update");
			if (row?.rowStatus !== "accepted" || row.issueSeverity === "blocking")
				return { status: "skipped" };
			const batch = await readBatch(scope.db, job);
			if (
				batch.status !== "committing" ||
				batch.selectedScope.commitJobId !== job.jobId ||
				batch.committedBy !== job.committedBy
			)
				return { status: "skipped" };
			let resolved: Awaited<ReturnType<typeof resolveCsvRecord>>;
			try {
				resolved = await resolveCsvRecord(
					scope.db,
					batch,
					sourceValues(row.sourcePayload),
				);
			} catch (error) {
				const message =
					error instanceof Error ? error.message : "Source no longer eligible";
				return holdCsvRow(scope.db, row.id, job, message);
			}
			const { record } = resolved;
			const employeeId = row.normalizedPayload.employeeId;
			if (
				typeof employeeId !== "string" ||
				employeeId !== scope.route.snapshot?.employeeId ||
				importedWorkSourceKey({
					provider: "csv",
					batchId: row.batchId,
					entityType: "work_period",
					providerSourceId: row.providerSourceId,
					sourcePayloadHash: row.sourcePayloadHash,
				}) !== scope.route.snapshot?.sourceKey
			)
				return scope.restart();
			if (
				resolved.employeeId !== employeeId ||
				hash(csvWorkIdentity(resolved)) !== row.providerSourceId ||
				canonicalJson(resolved.vehicleUse) !==
					canonicalJson(row.normalizedPayload.vehicleUse ?? null)
			) {
				const message =
					"Employee or vehicle mapping changed after review; check and accept the row again";
				return holdCsvRow(scope.db, row.id, job, message);
			}
			const occupancy = await csvWorkOccupancy(scope.db, batch, resolved);
			if (occupancy.kind === "duplicate") {
				const existing = await readWorkRecord(scope, {
					organizationId: job.organizationId,
					employeeId,
					workPeriodId: occupancy.workPeriodId,
				});
				if (existing?.agreement?.agrees) {
					await scope.db
						.update(importStagedRow)
						.set({
							rowStatus: "rejected",
							decisionReason: "duplicate",
							commitTargetTable: "work_period",
							commitTargetId: occupancy.workPeriodId,
							commitError: "Skipped: identical completed work already exists",
						})
						.where(and(rowWhere(job), eq(importStagedRow.id, row.id)));
					return { status: "skipped" };
				}
			}
			const source = {
				provider: "csv" as const,
				batchId: job.batchId,
				entityType: "work_period" as const,
				providerSourceId: row.providerSourceId,
				sourcePayloadHash: row.sourcePayloadHash,
			};
			// CSV records endpoint captures and vehicle evidence in a new frozen contract; API v1 receipts stay unchanged.
			const command = {
				version: 2,
				source,
				record,
				employeeId,
				vehicleUse: resolved.vehicleUse,
				operationId: row.id,
			};
			const [earlier] = await scope.db
				.select({ id: completedWorkOperation.id })
				.from(completedWorkOperation)
				.where(
					and(
						eq(completedWorkOperation.organizationId, job.organizationId),
						eq(completedWorkOperation.sourceKey, importedWorkSourceKey(source)),
					),
				)
				.limit(1);
			if (earlier) {
				const message =
					"This source already has an import receipt but no longer matches identical work; review the existing work";
				return holdCsvRow(scope.db, row.id, job, message, {
					reason: "source_collision",
					operationId: earlier.id,
				});
			}
			const created = await createImportedCompletedWork(scope, {
				organizationId: job.organizationId,
				employeeId,
				importerUserId: job.committedBy,
				start: parseInstant(record.start.at),
				end: parseInstant(record.end.at),
				recorded: null,
				captures: { start: record.start.capture, end: record.end.capture },
				vehicleUse: resolved.vehicleUse,
			});
			if (created.kind === "held") {
				const reason = created.hold.reason;
				const message =
					reason === "month_closed"
						? "The work touches a closed month; reopen the month before importing it"
						: reason === "occupancy_conflict"
							? "The time range overlaps existing work; imports never overwrite work"
							: "The existing work history needs review before this row can be imported";
				return holdCsvRow(scope.db, row.id, job, message, created.hold);
			}
			const workPeriodId = created.creation.segment.workPeriodId;
			await scope.db.insert(completedWorkOperation).values({
				id: row.id,
				organizationId: job.organizationId,
				employeeId,
				kind: "import_completed_work",
				writer: "reviewed_import",
				writerVersion: 2,
				commandVersion: 2,
				command,
				appendAdmission: scope.admission,
				actorKind: "human",
				actorUserId: job.committedBy,
				workPeriodId,
				resultVersion: 2,
				result: {
					version: 2,
					operationId: row.id,
					workPeriodId,
					owner: { employeeId },
					actors: { importing: { kind: "human", userId: job.committedBy } },
					source,
					start: record.start,
					end: record.end,
					segment: created.creation.segment,
					admission: scope.admission,
					revision: created.creation.after.revision,
				},
				sourceKey: importedWorkSourceKey(source),
			});
			await scope.db
				.update(importStagedRow)
				.set({
					rowStatus: "committed",
					commitTargetTable: "work_period",
					commitTargetId: workPeriodId,
					commitError: null,
				})
				.where(and(rowWhere(job), eq(importStagedRow.id, row.id)));
			return { status: "committed" };
		},
	);
}
