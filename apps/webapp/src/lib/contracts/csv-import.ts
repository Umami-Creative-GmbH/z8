import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { organization, user } from "@/db/auth-schema";
import {
	closedMonthEmployee,
	employee,
	employeeDeparture,
	employeeEmploymentPeriod,
	payrollSettledDay,
	workPolicy,
} from "@/db/schema";
import type { ContractChangeBatchExecutionMode } from "@/db/schema/contract-types";
import {
	comparePlainDates,
	type Instant,
	instantFromDate,
	parsePlainDate,
	plainDateAt,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { ConflictError, ValidationError } from "@/lib/effect/errors";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { isFormerEmployee } from "@/lib/employee-lifecycle/current-roster";
import { departureCutoff, retrospectiveDepartureCutoff } from "@/lib/employee-lifecycle/cutoff";
import { normalizePersonnelNumber } from "@/lib/organization/personnel-number";
import type { ContractType } from "@/lib/validations/employee";
import {
	type AsyncBatchEnqueuer,
	type BulkTermsUpdateChanges,
	type ContractChangeBatchReceipt,
	type CsvContractBatchItemPayload,
	type CsvDepartureBatchItemPayload,
	type CsvDepartureItemAction,
	INLINE_BATCH_THRESHOLD,
	type RunContractChangeBatchOptions,
	submitContractChangeBatch,
} from "./bulk-batch-engine";
import {
	parseIsoCalendarDate,
	VALID_ARBZG_SCOPES,
	VALID_BALANCE_MODES,
	VALID_EMPLOYMENT_PROFILES,
	VALID_ON_CALL_HOURS_KINDS,
	VALID_PRESENCE_OVERRIDES,
	VALID_SCHEDULE_MODES,
	VALID_SCHEDULE_SOURCES,
	validateAndNormalizeCustomDays,
	validateOnCallTerms,
	validateWeeklyContractMinutes,
} from "./contract-validation";
import { parseCsvBoolean, parseCsvCustomDays, parseCsvNumber, parseCsvText } from "./csv-parser";
import { loadEffectiveContractsBatch } from "./resolve-contract";
import type { EffectiveContractOnDay, WorkModel } from "./types";

const LOOKUP_CHUNK_SIZE = 1000;
const PREVIEW_CONTRACT_CHUNK_SIZE = 1000;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_WORK_MODELS: readonly WorkModel[] = ["onsite", "hybrid", "remote", "flexible"];
const VALID_CONTRACT_TYPES: readonly ContractType[] = ["fixed", "hourly"];

export type CsvImportRowStatus = "valid" | "warning" | "error";

export interface CsvContractPreviewRow {
	readonly rowNumber: number;
	readonly status: CsvImportRowStatus;
	readonly employeeIdentifier: string;
	readonly employeeId: string | null;
	readonly employeeName: string | null;
	readonly effectiveFromDate: string | null;
	readonly errors: readonly string[];
	readonly warnings: readonly string[];
	readonly previewDiff: Readonly<Record<string, { before: unknown; after: unknown }>>;
	readonly normalizedPayload: CsvContractBatchItemPayload | null;
}

export interface PreviewCsvContractImportInput {
	readonly organizationId: string;
	readonly csvText: string;
	readonly defaultEffectiveFromDate?: string | null;
	readonly overwritePersonalDivergences?: boolean;
	readonly delimiter?: "," | ";";
	readonly maxPreviewRows?: number;
}

export interface PreviewCsvContractImportResult {
	readonly operationKind: "csv_contract_import";
	readonly delimiter: "," | ";";
	readonly headers: readonly string[];
	readonly totalRows: number;
	readonly validRows: number;
	readonly warningRows: number;
	readonly errorRows: number;
	readonly canCommit: boolean;
	readonly executionMode: ContractChangeBatchExecutionMode;
	readonly confirmationFingerprint: string;
	readonly rowsTruncated: boolean;
	readonly rows: readonly CsvContractPreviewRow[];
}

export interface CsvLeavingDatePreviewRow {
	readonly rowNumber: number;
	readonly status: CsvImportRowStatus;
	readonly employeeIdentifier: string;
	readonly employeeId: string | null;
	readonly employeeName: string | null;
	readonly lastWorkingDay: string | null;
	readonly action: CsvDepartureItemAction | null;
	readonly errors: readonly string[];
	readonly warnings: readonly string[];
	readonly normalizedPayload: CsvDepartureBatchItemPayload | null;
}

export interface PreviewCsvLeavingDateImportInput {
	readonly organizationId: string;
	readonly csvText: string;
	readonly actorUserId?: string;
	readonly defaultAcknowledgeUnassignedDuties?: boolean;
	readonly now?: Instant;
	readonly delimiter?: "," | ";";
	readonly maxPreviewRows?: number;
}

export interface PreviewCsvLeavingDateImportResult {
	readonly operationKind: "csv_departure_import";
	readonly delimiter: "," | ";";
	readonly headers: readonly string[];
	readonly organizationTimezone: string;
	readonly totalRows: number;
	readonly validRows: number;
	readonly warningRows: number;
	readonly errorRows: number;
	readonly canCommit: boolean;
	readonly executionMode: ContractChangeBatchExecutionMode;
	readonly confirmationFingerprint: string;
	readonly rowsTruncated: boolean;
	readonly rows: readonly CsvLeavingDatePreviewRow[];
}

export interface CommitCsvImportBatchInput {
	readonly organizationId: string;
	readonly actorUserId: string;
	readonly requestId?: string;
	readonly operationKind: "csv_contract_import" | "csv_departure_import";
	readonly csvText: string;
	readonly confirmationFingerprint: string;
	readonly defaultEffectiveFromDate?: string | null;
	readonly overwritePersonalDivergences?: boolean;
	readonly defaultAcknowledgeUnassignedDuties?: boolean;
	readonly delimiter?: "," | ";";
	readonly now?: Date;
	readonly clockNow?: Instant;
	readonly enqueueAsyncJob?: AsyncBatchEnqueuer;
	readonly skipImmediateExecution?: boolean;
	readonly runnerOptions?: RunContractChangeBatchOptions;
}

interface ResolvedEmployeeRecord {
	readonly id: string;
	readonly userId: string;
	readonly firstName: string | null;
	readonly lastName: string | null;
	readonly employeeNumber: string | null;
	readonly email: string | null;
	readonly role: "admin" | "manager" | "employee";
	readonly isFormer: boolean;
}

function formatEmployeeName(emp: ResolvedEmployeeRecord): string {
	const full = [emp.firstName, emp.lastName].filter(Boolean).join(" ").trim();
	return full || emp.employeeNumber || emp.email || emp.id;
}

function buildEmployeeIdentifierLabel(values: Readonly<Record<string, string>>): string {
	return values.employee_number || values.email || values.employee_id || "(missing identifier)";
}

async function resolveEmployeesByIdentifiers(
	db: Pick<DatabaseClient, "select">,
	organizationId: string,
	identifiers: {
		ids: readonly string[];
		employeeNumbers: readonly string[];
		emails: readonly string[];
	},
	nowInstant: Instant,
): Promise<{
	byId: Map<string, ResolvedEmployeeRecord>;
	byNumber: Map<string, ResolvedEmployeeRecord>;
	byEmail: Map<string, ResolvedEmployeeRecord>;
	ambiguousEmails: Set<string>;
}> {
	const byId = new Map<string, ResolvedEmployeeRecord>();
	const byNumber = new Map<string, ResolvedEmployeeRecord>();
	const byEmail = new Map<string, ResolvedEmployeeRecord>();
	const ambiguousEmails = new Set<string>();

	const recordEmployee = (row: ResolvedEmployeeRecord) => {
		byId.set(row.id.toLowerCase(), row);
		if (row.employeeNumber) {
			const normNum = normalizePersonnelNumber(row.employeeNumber)?.toLowerCase();
			if (normNum) byNumber.set(normNum, row);
		}
		if (row.email) {
			const normEmail = row.email.trim().toLowerCase();
			const existing = byEmail.get(normEmail);
			if (existing && existing.id !== row.id) {
				ambiguousEmails.add(normEmail);
			} else {
				byEmail.set(normEmail, row);
			}
		}
	};

	const selectShape = {
		id: employee.id,
		userId: employee.userId,
		firstName: employee.firstName,
		lastName: employee.lastName,
		employeeNumber: employee.employeeNumber,
		email: user.email,
		role: employee.role,
		isFormer: isFormerEmployee(employee, nowInstant),
	};

	const uniqueIds = [...new Set(identifiers.ids.filter((id) => UUID_REGEX.test(id)))];
	for (let i = 0; i < uniqueIds.length; i += LOOKUP_CHUNK_SIZE) {
		const chunk = uniqueIds.slice(i, i + LOOKUP_CHUNK_SIZE);
		const rows = await db
			.select(selectShape)
			.from(employee)
			.leftJoin(user, eq(user.id, employee.userId))
			.where(and(eq(employee.organizationId, organizationId), inArray(employee.id, chunk)));
		for (const row of rows) {
			recordEmployee({ ...row, isFormer: Boolean(row.isFormer) });
		}
	}

	const uniqueNumbers = [
		...new Set(
			identifiers.employeeNumbers
				.map((n) => normalizePersonnelNumber(n)?.toLowerCase())
				.filter((n): n is string => Boolean(n)),
		),
	];
	for (let i = 0; i < uniqueNumbers.length; i += LOOKUP_CHUNK_SIZE) {
		const chunk = uniqueNumbers.slice(i, i + LOOKUP_CHUNK_SIZE);
		const rows = await db
			.select(selectShape)
			.from(employee)
			.leftJoin(user, eq(user.id, employee.userId))
			.where(
				and(
					eq(employee.organizationId, organizationId),
					inArray(sql`lower(btrim(${employee.employeeNumber}))`, chunk),
				),
			);
		for (const row of rows) {
			recordEmployee({ ...row, isFormer: Boolean(row.isFormer) });
		}
	}

	const uniqueEmails = [
		...new Set(identifiers.emails.map((e) => e.trim().toLowerCase()).filter(Boolean)),
	];
	for (let i = 0; i < uniqueEmails.length; i += LOOKUP_CHUNK_SIZE) {
		const chunk = uniqueEmails.slice(i, i + LOOKUP_CHUNK_SIZE);
		const rows = await db
			.select(selectShape)
			.from(employee)
			.leftJoin(user, eq(user.id, employee.userId))
			.where(
				and(
					eq(employee.organizationId, organizationId),
					inArray(sql`lower(btrim(${user.email}))`, chunk),
				),
			);
		for (const row of rows) {
			recordEmployee({ ...row, isFormer: Boolean(row.isFormer) });
		}
	}

	return { byId, byNumber, byEmail, ambiguousEmails };
}

function matchEmployeeForRow(
	values: Readonly<Record<string, string>>,
	lookup: Awaited<ReturnType<typeof resolveEmployeesByIdentifiers>>,
	errors: string[],
	prefix = "",
): ResolvedEmployeeRecord | null {
	const idKey = prefix ? `${prefix}employee_id` : "employee_id";
	const numKey = prefix ? `${prefix}employee_number` : "employee_number";
	const emailKey = prefix ? `${prefix}email` : "email";

	const rawId = values[idKey]?.trim() ?? "";
	const rawNum = values[numKey]?.trim() ?? "";
	const rawEmail = values[emailKey]?.trim() ?? "";

	if (!rawId && !rawNum && !rawEmail) {
		if (!prefix) {
			errors.push("Missing employee identifier (employee_id, employee_number, or email).");
		}
		return null;
	}

	const matches: ResolvedEmployeeRecord[] = [];

	if (rawId) {
		if (!UUID_REGEX.test(rawId)) {
			errors.push(`Invalid ${idKey} UUID "${rawId}".`);
		} else {
			const hit = lookup.byId.get(rawId.toLowerCase());
			if (!hit) errors.push(`Employee not found in organization for ${idKey} "${rawId}".`);
			else matches.push(hit);
		}
	}

	if (rawNum) {
		const norm = normalizePersonnelNumber(rawNum)?.toLowerCase();
		const hit = norm ? lookup.byNumber.get(norm) : undefined;
		if (!hit) {
			errors.push(`Employee not found in organization for ${numKey} "${rawNum}".`);
		} else {
			matches.push(hit);
		}
	}

	if (rawEmail) {
		const normEmail = rawEmail.toLowerCase();
		if (lookup.ambiguousEmails.has(normEmail)) {
			errors.push(`Multiple employees match ${emailKey} "${rawEmail}".`);
		} else {
			const hit = lookup.byEmail.get(normEmail);
			if (!hit) {
				errors.push(`Employee not found in organization for ${emailKey} "${rawEmail}".`);
			} else {
				matches.push(hit);
			}
		}
	}

	if (matches.length === 0) return null;
	const first = matches[0];
	if (matches.some((m) => m.id !== first.id)) {
		errors.push("Conflicting employee identifiers point to different employees.");
		return null;
	}
	return first;
}

function computeCsvConfirmationFingerprint(input: {
	organizationId: string;
	operationKind: "csv_contract_import" | "csv_departure_import";
	options: Record<string, unknown>;
	items: readonly { employeeId: string; payload: unknown }[];
}): string {
	const sorted = [...input.items].sort((a, b) => a.employeeId.localeCompare(b.employeeId));
	return createHash("sha256")
		.update(
			JSON.stringify({
				organizationId: input.organizationId,
				operationKind: input.operationKind,
				options: input.options,
				items: sorted,
			}),
		)
		.digest("hex");
}

function parseEnumCell<T extends string>(
	raw: string | undefined,
	allowed: readonly T[],
	field: string,
	errors: string[],
): T | undefined {
	if (raw === undefined || raw.trim() === "") return undefined;
	const lower = raw.trim().toLowerCase();
	if ((allowed as readonly string[]).includes(lower)) {
		return lower as T;
	}
	errors.push(`Invalid ${field} "${raw}". Allowed: ${allowed.join(", ")}.`);
	return undefined;
}

/**
 * Strictly read-only dry-run validation and preview for a CSV contract update file.
 * Resolves employees and work policies strictly inside `organizationId`, validates
 * every row against the contract domain rules, reports per-row errors/warnings/diffs,
 * and emits a `confirmationFingerprint` required by `commitCsvImportBatch`.
 */
export async function previewCsvContractImport(
	db: Pick<DatabaseClient, "select">,
	input: PreviewCsvContractImportInput,
): Promise<PreviewCsvContractImportResult> {
	let parsed: ReturnType<typeof parseCsvText>;
	try {
		parsed = parseCsvText(input.csvText, { delimiter: input.delimiter });
	} catch (error) {
		throw new ValidationError({
			message: error instanceof Error ? error.message : "Invalid CSV syntax",
			field: "csvText",
			refusal: "invalid_csv",
		});
	}

	const defaultDate = input.defaultEffectiveFromDate
		? parseIsoCalendarDate(input.defaultEffectiveFromDate, "defaultEffectiveFromDate")
		: null;
	const overwritePersonalDivergences = input.overwritePersonalDivergences ?? false;
	const nowInstant = systemClock.nowInstant();

	const ids: string[] = [];
	const numbers: string[] = [];
	const emails: string[] = [];
	for (const row of parsed.rows) {
		if (row.values.employee_id) ids.push(row.values.employee_id);
		if (row.values.employee_number) numbers.push(row.values.employee_number);
		if (row.values.email) emails.push(row.values.email);
	}

	const [empLookup, orgPolicies] = await Promise.all([
		resolveEmployeesByIdentifiers(
			db,
			input.organizationId,
			{ ids, employeeNumbers: numbers, emails },
			nowInstant,
		),
		db
			.select({ id: workPolicy.id, name: workPolicy.name, isActive: workPolicy.isActive })
			.from(workPolicy)
			.where(eq(workPolicy.organizationId, input.organizationId)),
	]);

	const policyById = new Map(orgPolicies.map((p) => [p.id.toLowerCase(), p]));
	const policyByName = new Map<string, { id: string; name: string; isActive: boolean }>();
	for (const p of orgPolicies) {
		policyByName.set(p.name.trim().toLowerCase(), p);
	}

	interface IntermediateRow {
		rowNumber: number;
		employeeIdentifier: string;
		employee: ResolvedEmployeeRecord | null;
		effectiveFromDate: string | null;
		changes: BulkTermsUpdateChanges;
		errors: string[];
		warnings: string[];
	}

	const seenEmployeeIds = new Set<string>();
	const intermediates: IntermediateRow[] = [];

	for (const row of parsed.rows) {
		const errors: string[] = [];
		const warnings: string[] = [];
		const v = row.values;
		const employeeIdentifier = buildEmployeeIdentifierLabel(v);

		const emp = matchEmployeeForRow(v, empLookup, errors);
		if (emp) {
			if (emp.isFormer) {
				errors.push("Employee is no longer on the current roster (rehire before updating terms).");
			}
			if (seenEmployeeIds.has(emp.id)) {
				errors.push("Duplicate employee row in CSV import.");
			} else {
				seenEmployeeIds.add(emp.id);
			}
		}

		let effectiveFromDate: string | null = defaultDate;
		if (v.effective_from_date) {
			try {
				effectiveFromDate = parseIsoCalendarDate(v.effective_from_date, "effective_from_date");
			} catch (error) {
				errors.push(error instanceof Error ? error.message : "Invalid effective_from_date.");
			}
		}
		if (!effectiveFromDate) {
			errors.push("Missing effective_from_date (and no default effective date provided).");
		}

		const changes: Record<string, unknown> = {};

		// Work policy resolution
		const clearPin = (() => {
			try {
				return parseCsvBoolean(v.clear_personal_policy_pin);
			} catch (error) {
				errors.push(error instanceof Error ? error.message : "Invalid clear_personal_policy_pin.");
				return null;
			}
		})();
		if (clearPin === true) {
			changes.clearPersonalPolicyPin = true;
		} else if (v.work_policy_id) {
			const policy = policyById.get(v.work_policy_id.toLowerCase());
			if (!policy) {
				errors.push(`Work policy not found in organization: "${v.work_policy_id}".`);
			} else if (!policy.isActive) {
				errors.push(`Work policy "${policy.name}" is inactive.`);
			} else {
				changes.workPolicyId = policy.id;
			}
		} else if (v.work_policy_name) {
			const policy = policyByName.get(v.work_policy_name.trim().toLowerCase());
			if (!policy) {
				errors.push(`Work policy not found in organization: "${v.work_policy_name}".`);
			} else if (!policy.isActive) {
				errors.push(`Work policy "${policy.name}" is inactive.`);
			} else {
				changes.workPolicyId = policy.id;
			}
		}

		// Weekly hours / minutes
		if (v.weekly_contract_minutes) {
			try {
				const num = parseCsvNumber(v.weekly_contract_minutes);
				if (num !== null) {
					changes.weeklyContractMinutes = validateWeeklyContractMinutes(
						Math.round(num),
						"weekly_contract_minutes",
					);
				}
			} catch (error) {
				errors.push(error instanceof Error ? error.message : "Invalid weekly_contract_minutes.");
			}
		} else if (v.weekly_hours) {
			try {
				const hours = parseCsvNumber(v.weekly_hours);
				if (hours !== null) {
					changes.weeklyContractMinutes = validateWeeklyContractMinutes(
						Math.round(hours * 60),
						"weekly_hours",
					);
				}
			} catch (error) {
				errors.push(error instanceof Error ? error.message : "Invalid weekly_hours.");
			}
		}

		const scheduleMode = parseEnumCell(
			v.schedule_mode,
			VALID_SCHEDULE_MODES,
			"schedule_mode",
			errors,
		);
		if (scheduleMode !== undefined) changes.scheduleMode = scheduleMode;

		if (v.custom_days) {
			try {
				const parsedDays = parseCsvCustomDays(v.custom_days);
				if (parsedDays) {
					const normalized = validateAndNormalizeCustomDays(
						scheduleMode ?? "custom_days",
						parsedDays,
						"custom_days",
					);
					changes.customDays = normalized;
					if (scheduleMode === undefined) {
						changes.scheduleMode = "custom_days";
					}
				}
			} catch (error) {
				errors.push(error instanceof Error ? error.message : "Invalid custom_days.");
			}
		} else if (scheduleMode === "custom_days") {
			errors.push("custom_days is required when schedule_mode is custom_days.");
		}

		const workModel = parseEnumCell(v.work_model, VALID_WORK_MODELS, "work_model", errors);
		if (workModel !== undefined) changes.workModel = workModel;

		const presenceOverride = parseEnumCell(
			v.presence_override,
			VALID_PRESENCE_OVERRIDES,
			"presence_override",
			errors,
		);
		if (presenceOverride !== undefined) changes.presenceOverride = presenceOverride;

		const balanceMode = parseEnumCell(v.balance_mode, VALID_BALANCE_MODES, "balance_mode", errors);
		if (balanceMode !== undefined) changes.balanceMode = balanceMode;

		const scheduleSource = parseEnumCell(
			v.schedule_source,
			VALID_SCHEDULE_SOURCES,
			"schedule_source",
			errors,
		);
		if (scheduleSource !== undefined) changes.scheduleSource = scheduleSource;

		const contractType = parseEnumCell(
			v.contract_type,
			VALID_CONTRACT_TYPES,
			"contract_type",
			errors,
		);
		if (contractType !== undefined) changes.contractType = contractType;

		if (v.hourly_rate) {
			try {
				const rate = parseCsvNumber(v.hourly_rate);
				if (rate !== null) {
					if (rate < 0) errors.push("hourly_rate must be non-negative.");
					else changes.hourlyRate = rate;
				}
			} catch (error) {
				errors.push(error instanceof Error ? error.message : "Invalid hourly_rate.");
			}
		}

		if (v.currency) {
			const cur = v.currency.trim().toUpperCase();
			if (cur.length < 3 || cur.length > 10) {
				errors.push(`Invalid currency "${v.currency}".`);
			} else {
				changes.currency = cur;
			}
		}

		const employmentProfile = parseEnumCell(
			v.employment_profile,
			VALID_EMPLOYMENT_PROFILES,
			"employment_profile",
			errors,
		);
		if (employmentProfile !== undefined) changes.employmentProfile = employmentProfile;

		const arbzgScope = parseEnumCell(v.arbzg_scope, VALID_ARBZG_SCOPES, "arbzg_scope", errors);
		if (arbzgScope !== undefined) changes.arbzgScope = arbzgScope;

		const onCallHoursKind = parseEnumCell(
			v.on_call_hours_kind,
			VALID_ON_CALL_HOURS_KINDS,
			"on_call_hours_kind",
			errors,
		);
		let onCallWeeklyMinutes: number | null | undefined;
		if (v.on_call_weekly_minutes) {
			try {
				const n = parseCsvNumber(v.on_call_weekly_minutes);
				if (n !== null) onCallWeeklyMinutes = Math.round(n);
			} catch (error) {
				errors.push(error instanceof Error ? error.message : "Invalid on_call_weekly_minutes.");
			}
		} else if (v.on_call_weekly_hours) {
			try {
				const h = parseCsvNumber(v.on_call_weekly_hours);
				if (h !== null) onCallWeeklyMinutes = Math.round(h * 60);
			} catch (error) {
				errors.push(error instanceof Error ? error.message : "Invalid on_call_weekly_hours.");
			}
		}
		let onCallDailyMinutes: number | null | undefined;
		if (v.on_call_daily_minutes) {
			try {
				const n = parseCsvNumber(v.on_call_daily_minutes);
				if (n !== null) onCallDailyMinutes = Math.round(n);
			} catch (error) {
				errors.push(error instanceof Error ? error.message : "Invalid on_call_daily_minutes.");
			}
		}

		if (
			scheduleSource !== undefined ||
			onCallHoursKind !== undefined ||
			onCallWeeklyMinutes !== undefined ||
			onCallDailyMinutes !== undefined
		) {
			try {
				const validatedOnCall = validateOnCallTerms({
					scheduleSource: scheduleSource ?? null,
					onCallHoursKind: onCallHoursKind ?? null,
					onCallWeeklyMinutes: onCallWeeklyMinutes ?? null,
					onCallDailyMinutes: onCallDailyMinutes ?? null,
					requireKindWhenOnCall: true,
				});
				if (scheduleSource === "on_call") {
					changes.onCallHoursKind = validatedOnCall.onCallHoursKind;
					changes.onCallWeeklyMinutes = validatedOnCall.onCallWeeklyMinutes;
					changes.onCallDailyMinutes = validatedOnCall.onCallDailyMinutes;
				}
			} catch (error) {
				errors.push(error instanceof Error ? error.message : "Invalid on-call agreement fields.");
			}
		}

		const reason = v.change_reason || v.reason || null;
		if (reason) changes.changeReason = reason;

		const substantiveKeys = Object.keys(changes).filter((k) => k !== "changeReason");
		if (substantiveKeys.length === 0) {
			errors.push("Row does not specify any contract fields to update.");
		}

		intermediates.push({
			rowNumber: row.rowNumber,
			employeeIdentifier,
			employee: emp,
			effectiveFromDate,
			changes: changes as BulkTermsUpdateChanges,
			errors,
			warnings,
		});
	}

	// Load current effective contracts grouped by effective date in bounded chunks for preview diffs & divergence checks
	const contractsByKey = new Map<string, EffectiveContractOnDay>();
	const employeeIdsByDate = new Map<string, Set<string>>();
	for (const row of intermediates) {
		if (row.errors.length === 0 && row.employee && row.effectiveFromDate) {
			const set = employeeIdsByDate.get(row.effectiveFromDate) ?? new Set<string>();
			set.add(row.employee.id);
			employeeIdsByDate.set(row.effectiveFromDate, set);
		}
	}

	for (const [date, empIdSet] of employeeIdsByDate.entries()) {
		const empIds = [...empIdSet];
		for (let i = 0; i < empIds.length; i += PREVIEW_CONTRACT_CHUNK_SIZE) {
			const chunk = empIds.slice(i, i + PREVIEW_CONTRACT_CHUNK_SIZE);
			const batch = await loadEffectiveContractsBatch(db, {
				organizationId: input.organizationId,
				employeeIds: chunk,
				dates: [date],
			});
			for (const empId of chunk) {
				const resolved = batch.get(empId)?.get(date);
				if (resolved) contractsByKey.set(`${empId}:${date}`, resolved);
			}
		}
	}

	const maxPreviewRows = input.maxPreviewRows ?? Number.POSITIVE_INFINITY;
	const previewRows: CsvContractPreviewRow[] = [];
	const fingerprintItems: { employeeId: string; payload: CsvContractBatchItemPayload }[] = [];

	let validRows = 0;
	let warningRows = 0;
	let errorRows = 0;

	for (const row of intermediates) {
		const errors = [...row.errors];
		const warnings = [...row.warnings];
		const previewDiff: Record<string, { before: unknown; after: unknown }> = {};

		const current =
			row.employee && row.effectiveFromDate
				? contractsByKey.get(`${row.employee.id}:${row.effectiveFromDate}`)
				: undefined;

		if (errors.length === 0 && current) {
			if (!current.isEmployedOnDay) {
				errors.push("Employee has no active employment period on the effective date.");
			}
			const nextContractType = row.changes.contractType ?? current.contractType;
			const nextHourlyRate =
				row.changes.hourlyRate !== undefined ? row.changes.hourlyRate : current.hourlyRate;
			if (nextContractType === "hourly" && nextHourlyRate == null) {
				errors.push("Hourly contract requires an hourly_rate value.");
			}

			const checkField = (
				field: string,
				requested: unknown,
				currentVal: unknown,
				isDiverged: boolean,
			) => {
				if (requested === undefined) return;
				if (!overwritePersonalDivergences && isDiverged) {
					warnings.push(`Personal divergence on ${field} will be preserved.`);
				} else if (requested !== currentVal) {
					previewDiff[field] = { before: currentVal, after: requested };
				}
			};

			checkField(
				"workPolicy",
				row.changes.clearPersonalPolicyPin ? null : row.changes.workPolicyId,
				current.workPolicy?.policyId ?? null,
				current.workPolicySource === "employee_override",
			);
			checkField(
				"weeklyContractMinutes",
				row.changes.weeklyContractMinutes,
				current.weeklyContractMinutes,
				current.weeklyContractMinutesSource === "employee_override",
			);
			checkField(
				"scheduleMode",
				row.changes.scheduleMode,
				current.scheduleMode,
				current.scheduleModeSource === "employee_override",
			);
			checkField(
				"workModel",
				row.changes.workModel,
				current.workModel,
				current.workModelSource === "employee_override",
			);
			checkField(
				"presenceOverride",
				row.changes.presenceOverride,
				current.presenceOverride,
				current.presenceOverrideSource === "employee_override",
			);
			checkField(
				"balanceMode",
				row.changes.balanceMode,
				current.balanceMode,
				current.balanceModeSource === "employee_override",
			);
			checkField(
				"scheduleSource",
				row.changes.scheduleSource,
				current.scheduleSource,
				current.scheduleSourceSource === "employee_override",
			);

			if (
				row.changes.contractType !== undefined &&
				row.changes.contractType !== current.contractType
			) {
				previewDiff.contractType = {
					before: current.contractType,
					after: row.changes.contractType,
				};
			}
			if (row.changes.hourlyRate !== undefined && row.changes.hourlyRate !== current.hourlyRate) {
				previewDiff.hourlyRate = { before: current.hourlyRate, after: row.changes.hourlyRate };
			}
			if (
				row.changes.employmentProfile !== undefined &&
				row.changes.employmentProfile !== current.employmentProfile
			) {
				previewDiff.employmentProfile = {
					before: current.employmentProfile,
					after: row.changes.employmentProfile,
				};
			}
			if (row.changes.arbzgScope !== undefined && row.changes.arbzgScope !== current.arbzgScope) {
				previewDiff.arbzgScope = { before: current.arbzgScope, after: row.changes.arbzgScope };
			}
		}

		let status: CsvImportRowStatus;
		let normalizedPayload: CsvContractBatchItemPayload | null = null;
		if (errors.length > 0 || !row.employee || !row.effectiveFromDate) {
			status = "error";
			errorRows += 1;
		} else {
			normalizedPayload = {
				rowNumber: row.rowNumber,
				effectiveFromDate: row.effectiveFromDate,
				overwritePersonalDivergences,
				changes: row.changes,
			};
			fingerprintItems.push({ employeeId: row.employee.id, payload: normalizedPayload });
			if (warnings.length > 0) {
				status = "warning";
				warningRows += 1;
				validRows += 1;
			} else {
				status = "valid";
				validRows += 1;
			}
		}

		if (previewRows.length < maxPreviewRows) {
			previewRows.push({
				rowNumber: row.rowNumber,
				status,
				employeeIdentifier: row.employeeIdentifier,
				employeeId: row.employee?.id ?? null,
				employeeName: row.employee ? formatEmployeeName(row.employee) : null,
				effectiveFromDate: row.effectiveFromDate,
				errors,
				warnings,
				previewDiff,
				normalizedPayload,
			});
		}
	}

	const confirmationFingerprint = computeCsvConfirmationFingerprint({
		organizationId: input.organizationId,
		operationKind: "csv_contract_import",
		options: { defaultDate, overwritePersonalDivergences },
		items: fingerprintItems,
	});

	return {
		operationKind: "csv_contract_import",
		delimiter: parsed.delimiter,
		headers: parsed.headers,
		totalRows: intermediates.length,
		validRows,
		warningRows,
		errorRows,
		canCommit: errorRows === 0 && validRows > 0,
		executionMode: validRows <= INLINE_BATCH_THRESHOLD ? "inline" : "async",
		confirmationFingerprint,
		rowsTruncated: intermediates.length > previewRows.length,
		rows: previewRows,
	};
}

/**
 * Strictly read-only dry-run validation and preview for a CSV leaving-date import.
 * Classifies each row into the exact `#1929` lifecycle command (`schedule_departure`,
 * `offboard_immediately`, `record_past_departure`, `correct_past_departure_date`,
 * `record_historical_departure_date`, or `skip_unchanged`), flags closed-month /
 * settled-payroll reconciliation warnings without mutating payroll, and enforces
 * `departure_reopen_forbidden` on former employees.
 */
export async function previewCsvLeavingDateImport(
	db: Pick<DatabaseClient, "select">,
	input: PreviewCsvLeavingDateImportInput,
): Promise<PreviewCsvLeavingDateImportResult> {
	let parsed: ReturnType<typeof parseCsvText>;
	try {
		parsed = parseCsvText(input.csvText, { delimiter: input.delimiter });
	} catch (error) {
		throw new ValidationError({
			message: error instanceof Error ? error.message : "Invalid CSV syntax",
			field: "csvText",
			refusal: "invalid_csv",
		});
	}

	const nowInstant = input.now ?? systemClock.nowInstant();
	const defaultAck = input.defaultAcknowledgeUnassignedDuties ?? true;

	const [orgRow] = await db
		.select({ timezone: organization.timezone })
		.from(organization)
		.where(eq(organization.id, input.organizationId))
		.limit(1);
	const orgTimezone = orgRow?.timezone ?? "UTC";
	const today = plainDateAt(nowInstant, orgTimezone);

	const ids: string[] = [];
	const numbers: string[] = [];
	const emails: string[] = [];
	for (const row of parsed.rows) {
		if (row.values.employee_id) ids.push(row.values.employee_id);
		if (row.values.employee_number) numbers.push(row.values.employee_number);
		if (row.values.email) emails.push(row.values.email);
		if (row.values.replacement_employee_id) ids.push(row.values.replacement_employee_id);
		if (row.values.replacement_employee_number) {
			numbers.push(row.values.replacement_employee_number);
		}
		if (row.values.replacement_email) emails.push(row.values.replacement_email);
	}

	const empLookup = await resolveEmployeesByIdentifiers(
		db,
		input.organizationId,
		{ ids, employeeNumbers: numbers, emails },
		nowInstant,
	);

	// Collect matched employee IDs to preload periods, departures, closed months, and settled days in bulk
	const matchedEmployeeIds = new Set<string>();
	for (const row of parsed.rows) {
		const tmpErrors: string[] = [];
		const emp = matchEmployeeForRow(row.values, empLookup, tmpErrors);
		if (emp) matchedEmployeeIds.add(emp.id);
	}

	const empIdList = [...matchedEmployeeIds];
	const periodsByEmp = new Map<
		string,
		{ id: string; status: string; startedAt: Date | null; endedAt: Date | null }[]
	>();
	const departuresByEmp = new Map<
		string,
		{
			id: string;
			status: string;
			revision: number;
			lastWorkingDay: string | null;
			timezone: string;
			employmentPeriodId: string;
		}[]
	>();
	const closedMonthsByEmp = new Map<string, { month: string; rangeEnd: Date }[]>();
	const settledDaysByEmp = new Map<string, string[]>();

	for (let i = 0; i < empIdList.length; i += LOOKUP_CHUNK_SIZE) {
		const chunk = empIdList.slice(i, i + LOOKUP_CHUNK_SIZE);
		const [periodRows, departureRows, closedRows, settledRows] = await Promise.all([
			db
				.select({
					id: employeeEmploymentPeriod.id,
					employeeId: employeeEmploymentPeriod.employeeId,
					status: employeeEmploymentPeriod.status,
					startedAt: employeeEmploymentPeriod.startedAt,
					endedAt: employeeEmploymentPeriod.endedAt,
				})
				.from(employeeEmploymentPeriod)
				.where(
					and(
						eq(employeeEmploymentPeriod.organizationId, input.organizationId),
						inArray(employeeEmploymentPeriod.employeeId, chunk),
					),
				),
			db
				.select({
					id: employeeDeparture.id,
					employeeId: employeeDeparture.employeeId,
					status: employeeDeparture.status,
					revision: employeeDeparture.revision,
					lastWorkingDay: employeeDeparture.lastWorkingDay,
					timezone: employeeDeparture.timezone,
					employmentPeriodId: employeeDeparture.employmentPeriodId,
				})
				.from(employeeDeparture)
				.where(
					and(
						eq(employeeDeparture.organizationId, input.organizationId),
						inArray(employeeDeparture.employeeId, chunk),
						inArray(employeeDeparture.status, ["pending", "effective"]),
					),
				)
				.orderBy(desc(employeeDeparture.createdAt)),
			db
				.select({
					employeeId: closedMonthEmployee.employeeId,
					month: closedMonthEmployee.month,
					rangeEnd: closedMonthEmployee.rangeEnd,
				})
				.from(closedMonthEmployee)
				.where(
					and(
						eq(closedMonthEmployee.organizationId, input.organizationId),
						inArray(closedMonthEmployee.employeeId, chunk),
						isNull(closedMonthEmployee.reopenedAt),
					),
				),
			db
				.select({
					employeeId: payrollSettledDay.employeeId,
					date: payrollSettledDay.date,
				})
				.from(payrollSettledDay)
				.where(
					and(
						eq(payrollSettledDay.organizationId, input.organizationId),
						inArray(payrollSettledDay.employeeId, chunk),
						isNull(payrollSettledDay.unsettledAt),
					),
				),
		]);

		for (const p of periodRows) {
			const list = periodsByEmp.get(p.employeeId) ?? [];
			list.push(p);
			periodsByEmp.set(p.employeeId, list);
		}
		for (const d of departureRows) {
			const list = departuresByEmp.get(d.employeeId) ?? [];
			list.push(d);
			departuresByEmp.set(d.employeeId, list);
		}
		for (const c of closedRows) {
			const list = closedMonthsByEmp.get(c.employeeId) ?? [];
			list.push({ month: c.month, rangeEnd: c.rangeEnd });
			closedMonthsByEmp.set(c.employeeId, list);
		}
		for (const s of settledRows) {
			const list = settledDaysByEmp.get(s.employeeId) ?? [];
			list.push(s.date);
			settledDaysByEmp.set(s.employeeId, list);
		}
	}

	const maxPreviewRows = input.maxPreviewRows ?? Number.POSITIVE_INFINITY;
	const previewRows: CsvLeavingDatePreviewRow[] = [];
	const fingerprintItems: { employeeId: string; payload: CsvDepartureBatchItemPayload }[] = [];
	const seenEmployees = new Set<string>();

	let validRows = 0;
	let warningRows = 0;
	let errorRows = 0;

	for (const row of parsed.rows) {
		const v = row.values;
		const errors: string[] = [];
		const warnings: string[] = [];
		const employeeIdentifier = buildEmployeeIdentifierLabel(v);

		const emp = matchEmployeeForRow(v, empLookup, errors);
		if (emp) {
			if (seenEmployees.has(emp.id)) {
				errors.push("Duplicate employee row in CSV import.");
			} else {
				seenEmployees.add(emp.id);
			}
			if (input.actorUserId && emp.userId === input.actorUserId && !emp.isFormer) {
				errors.push("You cannot record a departure for your own employee record.");
			}
		}

		let lastWorkingDay: string | null = null;
		if (!v.last_working_day) {
			errors.push("Missing last_working_day (leaving date).");
		} else {
			try {
				lastWorkingDay = parseIsoCalendarDate(v.last_working_day, "last_working_day");
			} catch (error) {
				errors.push(error instanceof Error ? error.message : "Invalid last_working_day.");
			}
		}

		const modeRaw = v.departure_mode?.trim().toLowerCase() || null;
		if (
			modeRaw &&
			modeRaw !== "scheduled" &&
			modeRaw !== "immediate" &&
			modeRaw !== "retrospective"
		) {
			errors.push(
				`Invalid departure_mode "${v.departure_mode}". Allowed: scheduled, immediate, retrospective.`,
			);
		}

		let replacement: ResolvedEmployeeRecord | null = null;
		if (v.replacement_employee_id || v.replacement_employee_number || v.replacement_email) {
			replacement = matchEmployeeForRow(v, empLookup, errors, "replacement_");
			if (replacement) {
				if (emp && replacement.id === emp.id) {
					errors.push("Replacement employee cannot be the departing employee.");
				}
				if (replacement.isFormer) {
					errors.push("Replacement employee must be on the current roster.");
				}
				if (replacement.role !== "admin" && replacement.role !== "manager") {
					errors.push("Replacement employee must be an admin or manager.");
				}
			}
		}

		let acknowledgeUnassignedDuties = defaultAck;
		if (v.acknowledge_unassigned_duties) {
			try {
				const parsedAck = parseCsvBoolean(v.acknowledge_unassigned_duties);
				if (parsedAck !== null) acknowledgeUnassignedDuties = parsedAck;
			} catch (error) {
				errors.push(
					error instanceof Error ? error.message : "Invalid acknowledge_unassigned_duties.",
				);
			}
		}

		const reason = v.reason || v.change_reason || null;

		let action: CsvDepartureItemAction | null = null;
		let expectedDepartureId: string | null = null;
		let expectedRevision: number | null = null;

		if (errors.length === 0 && emp && lastWorkingDay) {
			const parsedDay = parsePlainDate(lastWorkingDay);
			const dayCmp = comparePlainDates(parsedDay, today);
			const empPeriods = periodsByEmp.get(emp.id) ?? [];
			const openPeriod = empPeriods.find((p) => p.status === "open");
			const empDepartures = departuresByEmp.get(emp.id) ?? [];
			const pendingDeparture = empDepartures.find((d) => d.status === "pending");
			const effectiveDeparture = empDepartures.find((d) => d.status === "effective");

			if (!emp.isFormer && openPeriod) {
				if (modeRaw === "immediate" || (dayCmp === 0 && modeRaw !== "scheduled")) {
					action = "offboard_immediately";
					if (pendingDeparture) {
						warnings.push("Will supersede existing pending scheduled departure.");
					}
				} else if (dayCmp > 0 || (dayCmp === 0 && modeRaw === "scheduled")) {
					if (modeRaw === "retrospective") {
						errors.push("Retrospective departure mode requires a strictly past leaving date.");
					} else {
						try {
							departureCutoff({ lastWorkingDay, timezone: orgTimezone, now: nowInstant });
							action = "schedule_departure";
							if (pendingDeparture) {
								expectedDepartureId = pendingDeparture.id;
								expectedRevision = pendingDeparture.revision;
								warnings.push("Will reschedule existing pending departure.");
							}
						} catch (error) {
							errors.push(error instanceof Error ? error.message : "Invalid future leaving date.");
						}
					}
				} else {
					// Strictly past date for an active employee -> retrospective departure
					if (modeRaw === "scheduled") {
						errors.push("Scheduled departure mode cannot use a past leaving date.");
					} else {
						try {
							const cutoff = retrospectiveDepartureCutoff({
								lastWorkingDay,
								timezone: orgTimezone,
								now: nowInstant,
							});
							if (
								openPeriod.startedAt &&
								cutoff.cutoff.epochMilliseconds <
									instantFromDate(openPeriod.startedAt).epochMilliseconds
							) {
								errors.push("Leaving date cannot be earlier than the employee's start date.");
							} else {
								action = "record_past_departure";
								if (pendingDeparture) {
									warnings.push("Will supersede existing pending scheduled departure.");
								}
								const closedMonths = (closedMonthsByEmp.get(emp.id) ?? []).filter(
									(m) => m.rangeEnd.getTime() > cutoff.cutoff.epochMilliseconds,
								);
								const settledDays = (settledDaysByEmp.get(emp.id) ?? []).filter(
									(d) => d >= cutoff.cutoffLocalDate,
								);
								if (closedMonths.length > 0 || settledDays.length > 0) {
									warnings.push(
										"Touches closed month(s) or settled payroll days; payroll will stay untouched and a payroll_reconciliation review will be opened.",
									);
								}
							}
						} catch (error) {
							errors.push(error instanceof Error ? error.message : "Invalid past leaving date.");
						}
					}
				}
			} else {
				// Employee is already former / inactive
				if (dayCmp >= 0) {
					errors.push(
						"Cannot set today or a future leaving date for an already-former employee (departure_reopen_forbidden; use rehire instead).",
					);
				} else if (effectiveDeparture) {
					if (effectiveDeparture.lastWorkingDay === lastWorkingDay) {
						action = "skip_unchanged";
						warnings.push(
							"Effective departure already has this exact leaving date; row will be skipped.",
						);
					} else {
						action = "correct_past_departure_date";
						expectedDepartureId = effectiveDeparture.id;
						expectedRevision = effectiveDeparture.revision;
						warnings.push(
							`Will apply date-only correction to effective departure (${effectiveDeparture.lastWorkingDay ?? "unset"} → ${lastWorkingDay}).`,
						);
					}
				} else {
					action = "record_historical_departure_date";
					warnings.push("Will backfill historical leaving date for legacy former employee.");
				}
			}
		}

		let status: CsvImportRowStatus;
		let normalizedPayload: CsvDepartureBatchItemPayload | null = null;
		if (errors.length > 0 || !emp || !lastWorkingDay || !action) {
			status = "error";
			errorRows += 1;
		} else {
			normalizedPayload = {
				rowNumber: row.rowNumber,
				action,
				lastWorkingDay,
				replacementEmployeeId: replacement?.id ?? null,
				acknowledgeUnassignedDuties,
				reason,
				expectedDepartureId,
				expectedRevision,
			};
			fingerprintItems.push({ employeeId: emp.id, payload: normalizedPayload });
			if (warnings.length > 0) {
				status = "warning";
				warningRows += 1;
				validRows += 1;
			} else {
				status = "valid";
				validRows += 1;
			}
		}

		if (previewRows.length < maxPreviewRows) {
			previewRows.push({
				rowNumber: row.rowNumber,
				status,
				employeeIdentifier,
				employeeId: emp?.id ?? null,
				employeeName: emp ? formatEmployeeName(emp) : null,
				lastWorkingDay,
				action,
				errors,
				warnings,
				normalizedPayload,
			});
		}
	}

	const confirmationFingerprint = computeCsvConfirmationFingerprint({
		organizationId: input.organizationId,
		operationKind: "csv_departure_import",
		options: { defaultAck },
		items: fingerprintItems,
	});

	return {
		operationKind: "csv_departure_import",
		delimiter: parsed.delimiter,
		headers: parsed.headers,
		organizationTimezone: orgTimezone,
		totalRows: parsed.rows.length,
		validRows,
		warningRows,
		errorRows,
		canCommit: errorRows === 0 && validRows > 0,
		executionMode: validRows <= INLINE_BATCH_THRESHOLD ? "inline" : "async",
		confirmationFingerprint,
		rowsTruncated: parsed.rows.length > previewRows.length,
		rows: previewRows,
	};
}

/**
 * Commits a validated CSV contract or leaving-date import through the exact same
 * durable `submitContractChangeBatch` / `runContractChangeBatch` engine after
 * verifying `confirmationFingerprint` against a fresh dry-run parse.
 */
export async function commitCsvImportBatch(
	db: DatabaseClient,
	input: CommitCsvImportBatchInput,
): Promise<ContractChangeBatchReceipt> {
	const requestId = input.requestId ?? randomUUID();

	if (input.operationKind === "csv_contract_import") {
		const preview = await previewCsvContractImport(db, {
			organizationId: input.organizationId,
			csvText: input.csvText,
			defaultEffectiveFromDate: input.defaultEffectiveFromDate,
			overwritePersonalDivergences: input.overwritePersonalDivergences,
			delimiter: input.delimiter,
		});

		if (preview.errorRows > 0) {
			throw new ValidationError({
				message: `CSV contract import has ${preview.errorRows} row validation error(s) and cannot be committed.`,
				field: "csvText",
				refusal: "csv_validation_failed",
				value: { errorRows: preview.errorRows },
			});
		}
		if (preview.validRows === 0) {
			throw new ValidationError({
				message: "CSV contract import contains no valid rows to commit.",
				field: "csvText",
				refusal: "empty_batch",
			});
		}
		if (preview.confirmationFingerprint !== input.confirmationFingerprint) {
			throw new ConflictError({
				message:
					"CSV import confirmation fingerprint does not match the current dry-run preview. Re-run preview before committing.",
				conflictType: "confirmation_fingerprint_mismatch",
			});
		}

		const items = preview.rows
			.filter(
				(
					r,
				): r is CsvContractPreviewRow & {
					employeeId: string;
					normalizedPayload: CsvContractBatchItemPayload;
				} => r.employeeId !== null && r.normalizedPayload !== null,
			)
			.map((r) => ({
				employeeId: r.employeeId,
				payload: r.normalizedPayload as unknown as Record<string, unknown>,
			}));

		return submitContractChangeBatch(db, {
			organizationId: input.organizationId,
			actorUserId: input.actorUserId,
			requestId,
			operationKind: "csv_contract_import",
			payload: {
				confirmationFingerprint: preview.confirmationFingerprint,
				defaultEffectiveFromDate: input.defaultEffectiveFromDate ?? null,
				overwritePersonalDivergences: input.overwritePersonalDivergences ?? false,
				totalRows: preview.totalRows,
			},
			items,
			now: input.now,
			enqueueAsyncJob: input.enqueueAsyncJob,
			skipImmediateExecution: input.skipImmediateExecution,
			runnerOptions: input.runnerOptions,
		});
	}

	const preview = await previewCsvLeavingDateImport(db, {
		organizationId: input.organizationId,
		csvText: input.csvText,
		actorUserId: input.actorUserId,
		defaultAcknowledgeUnassignedDuties: input.defaultAcknowledgeUnassignedDuties,
		now: input.clockNow,
		delimiter: input.delimiter,
	});

	if (preview.errorRows > 0) {
		throw new ValidationError({
			message: `CSV leaving-date import has ${preview.errorRows} row validation error(s) and cannot be committed.`,
			field: "csvText",
			refusal: "csv_validation_failed",
			value: { errorRows: preview.errorRows },
		});
	}
	if (preview.validRows === 0) {
		throw new ValidationError({
			message: "CSV leaving-date import contains no valid rows to commit.",
			field: "csvText",
			refusal: "empty_batch",
		});
	}
	if (preview.confirmationFingerprint !== input.confirmationFingerprint) {
		throw new ConflictError({
			message:
				"CSV import confirmation fingerprint does not match the current dry-run preview. Re-run preview before committing.",
			conflictType: "confirmation_fingerprint_mismatch",
		});
	}

	const items = preview.rows
		.filter(
			(
				r,
			): r is CsvLeavingDatePreviewRow & {
				employeeId: string;
				normalizedPayload: CsvDepartureBatchItemPayload;
			} => r.employeeId !== null && r.normalizedPayload !== null,
		)
		.map((r) => ({
			employeeId: r.employeeId,
			payload: r.normalizedPayload as unknown as Record<string, unknown>,
		}));

	return submitContractChangeBatch(db, {
		organizationId: input.organizationId,
		actorUserId: input.actorUserId,
		requestId,
		operationKind: "csv_departure_import",
		payload: {
			confirmationFingerprint: preview.confirmationFingerprint,
			defaultAcknowledgeUnassignedDuties: input.defaultAcknowledgeUnassignedDuties ?? true,
			totalRows: preview.totalRows,
		},
		items,
		now: input.now,
		enqueueAsyncJob: input.enqueueAsyncJob,
		skipImmediateExecution: input.skipImmediateExecution,
		runnerOptions: input.runnerOptions,
	});
}
