import { sql } from "drizzle-orm";
import { dateFromInstant } from "@/lib/datetime/temporal-core";
import type {
	ApprovalDbService,
	ApprovalOutboxWriteResult,
	ApprovalOutboxWriter,
	JsonValue,
} from "../workflow/ports";

interface ExistingOutboxRow {
	id: string;
	workflowId: string;
	eventId: string;
	eventType: string;
	disposition: string;
	payload: unknown;
}

export class ApprovalOutboxIdempotencyConflictError extends Error {
	constructor(reason: "missing" | "identity_mismatch") {
		super(`Approval outbox idempotency conflict: ${reason}`);
		this.name = "ApprovalOutboxIdempotencyConflictError";
	}
}

function insertedId(result: unknown): string | null {
	if (!result || typeof result !== "object" || !("rows" in result)) return null;
	const rows = (result as { rows?: unknown }).rows;
	if (!Array.isArray(rows) || rows.length === 0) return null;
	const row = rows[0];
	if (!row || typeof row !== "object" || !("id" in row)) return null;
	return typeof row.id === "string" ? row.id : null;
}

function existingOutboxRow(result: unknown): ExistingOutboxRow | null {
	if (!result || typeof result !== "object" || !("rows" in result)) return null;
	const rows = result.rows;
	if (!Array.isArray(rows) || rows.length !== 1) return null;
	const row = rows[0];
	if (
		!row ||
		typeof row !== "object" ||
		!("id" in row) ||
		!("workflow_id" in row) ||
		!("event_id" in row) ||
		!("event_type" in row) ||
		!("disposition" in row) ||
		!("payload" in row) ||
		typeof row.id !== "string" ||
		typeof row.workflow_id !== "string" ||
		typeof row.event_id !== "string" ||
		typeof row.event_type !== "string" ||
		typeof row.disposition !== "string"
	) {
		return null;
	}
	return {
		id: row.id,
		workflowId: row.workflow_id,
		eventId: row.event_id,
		eventType: row.event_type,
		disposition: row.disposition,
		payload: row.payload,
	};
}

function invalidJson(): never {
	throw new Error("Outbox payload is not valid JSON");
}

function canonicalizeJson(
	value: unknown,
	ancestors: Set<object> = new Set(),
): JsonValue {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean"
	) {
		return value;
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) return invalidJson();
		return Object.is(value, -0) ? 0 : value;
	}
	if (typeof value !== "object") return invalidJson();
	if (ancestors.has(value)) return invalidJson();
	ancestors.add(value);

	try {
		if (Array.isArray(value)) {
			const canonical: JsonValue[] = [];
			for (let index = 0; index < value.length; index += 1) {
				if (!Object.hasOwn(value, index)) return invalidJson();
				const descriptor = Object.getOwnPropertyDescriptor(
					value,
					String(index),
				);
				if (!descriptor?.enumerable || !("value" in descriptor)) {
					return invalidJson();
				}
				canonical.push(canonicalizeJson(descriptor.value, ancestors));
			}
			const expectedKeys = new Set<string>([
				"length",
				...canonical.map((_, index) => String(index)),
			]);
			if (
				Reflect.ownKeys(value).some(
					(key) => typeof key !== "string" || !expectedKeys.has(key),
				)
			) {
				return invalidJson();
			}
			return canonical;
		}

		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) {
			return invalidJson();
		}
		const keys = Reflect.ownKeys(value);
		if (keys.some((key) => typeof key !== "string")) return invalidJson();
		const canonical = Object.create(null) as Record<string, JsonValue>;
		for (const key of (keys as string[]).sort()) {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (!descriptor?.enumerable || !("value" in descriptor)) {
				return invalidJson();
			}
			canonical[key] = canonicalizeJson(descriptor.value, ancestors);
		}
		return canonical;
	} finally {
		ancestors.delete(value);
	}
}

function canonicalJson(value: unknown): string {
	return JSON.stringify(canonicalizeJson(value));
}

export function createApprovalOutboxWriter(
	dbService: ApprovalDbService,
): ApprovalOutboxWriter {
	return {
		async write(input): Promise<ApprovalOutboxWriteResult> {
			const canonicalPayload = canonicalJson(input.payload);
			const result = await dbService.db.execute(sql`
				insert into approval_outbox (
					organization_id, workflow_id, event_id, event_type, dedupe_key,
					payload, disposition, expansion_status, created_at
				) values (
					${input.organizationId}, ${input.workflowId}, ${input.eventId},
					${input.eventType}, ${input.dedupeKey},
					${canonicalPayload}::jsonb, ${input.disposition},
					${"pending"}, ${dateFromInstant(input.createdAt)}
				)
				on conflict (organization_id, dedupe_key) do nothing
				returning id
			`);
			const id = insertedId(result);
			if (id) return { kind: "inserted", id };

			const existing = existingOutboxRow(
				await dbService.db.execute(sql`
					select id, workflow_id, event_id, event_type, disposition, payload
					from approval_outbox
					where organization_id = ${input.organizationId}
						and dedupe_key = ${input.dedupeKey}
				`),
			);
			if (!existing) {
				throw new ApprovalOutboxIdempotencyConflictError("missing");
			}
			if (
				existing.workflowId !== input.workflowId ||
				existing.eventId !== input.eventId ||
				existing.eventType !== input.eventType ||
				existing.disposition !== input.disposition ||
				canonicalJson(existing.payload) !== canonicalPayload
			) {
				throw new ApprovalOutboxIdempotencyConflictError("identity_mismatch");
			}
			return { kind: "duplicate", id: existing.id };
		},
	};
}
