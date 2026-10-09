import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, not, sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import type { db } from "@/db";
import { user } from "@/db/auth-schema";
import {
	accountingConnection,
	auditLog,
	customer,
	employee,
	type InvoicedWorkShare,
	invoiceDraft,
	invoiceDraftLine,
	invoicedWork,
	project,
	workPeriod,
} from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { dateFromInstant, instantFromDate } from "@/lib/datetime/temporal-core";
import { offsetMinutesToTimeZoneId } from "@/lib/datetime/temporal-format";
import { createLogger } from "@/lib/logger";
import { formatUnits } from "@/lib/money/exact-decimal";
import {
	loadReportedProjectWork,
	loadReportRates,
	reportedWorkDay,
} from "@/lib/reports/project-report-work";
import type { Transaction } from "@/lib/time-tracking/work-transaction/ranks";
import {
	type AccountingDependencies,
	getActiveAccountingConnection,
	openAccountingProvider,
} from "../accounting/connection-store";
import {
	getCustomerContactLink,
	getEffectiveCustomerTaxTreatment,
} from "../accounting/customer-accounting";
import {
	checkInvoiceDraftFits,
	formatQuantityHours,
	type InvoiceDraft,
	type InvoiceDraftCapabilityProblem,
	type InvoiceDraftLine,
} from "../accounting/invoice-draft";
import {
	type AccountingProvider,
	type AccountingProviderCapabilities,
	isAccountingProviderError,
	isAccountingProviderKind,
} from "../accounting/provider";
import { formatTaxRate, taxTreatmentFromStored } from "../accounting/tax-treatment";
import { taxTreatmentView } from "../accounting/views";
import { isBillableCurrency } from "../currency";
import { isUniqueViolation, isUuid, parsePlainDay } from "../input";
import { formatRate, rateFromStored } from "../money";
import { projectHasActiveCustomerSql } from "../project-customer";
import { getBillableTimeSettings, lockBillableTimeSettings } from "../settings";
import {
	compareCandidates,
	type HandOffCandidate,
	type HandOffLocale,
	type HandOffPeriod,
	type HandOffPlan,
	handOffDigestInput,
	handOffTextFormat,
	isHandOffLocale,
	minutesAsHundredths,
	planHandOff,
} from "./hand-off-plan";
import type {
	ChangedField,
	DraftToolStatusView,
	HandOffBlockerView,
	HandOffCustomerOption,
	HandOffLineView,
	HandOffPreview,
	HandOffWorkView,
	InvoiceDraftDetailView,
	InvoiceDraftStatusView,
	InvoiceDraftSummaryView,
	InvoicedWorkView,
	TimesheetRowView,
} from "./views";

/**
 * The hand-off (#903): preview a customer's un-invoiced billable work in a
 * period, confirm it into ONE invoice draft through the accounting provider
 * port, release drafts, check their status in the tool and clear
 * changed-after-invoicing marks. Callers authorize an org admin of
 * `organizationId` first; everything here is scoped to that organization.
 *
 * Idempotency: confirm records the attempt (draft, frozen lines and invoiced
 * work, status `pending`) in one transaction BEFORE it calls the tool, with the
 * caller's idempotency key. Every call of the tool for that draft carries the
 * same key, the same lines and the attempt's first instant, so a retry after a
 * timeout finds the draft the first call created instead of creating another,
 * and the work is invoiced once. No transaction is held across the call.
 */

const logger = createLogger("BillableTimeHandOff");

type Reader = Pick<typeof db, "select">;

const MAX_PERIOD_DAYS = 366;
const MAX_PROJECTS = 500;
const MAX_RELEASE_REASON = 500;

export interface HandOffRequest {
	customerId: string;
	period: HandOffPeriod;
	/** A subset of the customer's projects; null for all of them. */
	projectIds: string[] | null;
	includeTimesheet: boolean;
	locale: HandOffLocale;
}

export type HandOffRequestRefusal = "invalid_customer" | "invalid_period" | "invalid_projects";

/** Reads a hand-off request from untrusted input. */
export function parseHandOffRequest(
	input: unknown,
): { ok: true; request: HandOffRequest } | { ok: false; reason: HandOffRequestRefusal } {
	if (typeof input !== "object" || input === null) return { ok: false, reason: "invalid_customer" };
	const raw = input as Record<string, unknown>;
	if (!isUuid(raw.customerId)) {
		return { ok: false, reason: "invalid_customer" };
	}
	const from = parsePlainDay(raw.periodFrom);
	const to = parsePlainDay(raw.periodTo);
	if (
		!from ||
		!to ||
		Temporal.PlainDate.compare(from, to) > 0 ||
		from.until(to).days >= MAX_PERIOD_DAYS
	) {
		return { ok: false, reason: "invalid_period" };
	}
	let projectIds: string[] | null = null;
	if (raw.projectIds !== null && raw.projectIds !== undefined) {
		if (
			!Array.isArray(raw.projectIds) ||
			raw.projectIds.length === 0 ||
			raw.projectIds.length > MAX_PROJECTS ||
			!raw.projectIds.every((id) => isUuid(id))
		) {
			return { ok: false, reason: "invalid_projects" };
		}
		projectIds = [...new Set(raw.projectIds as string[])];
	}
	return {
		ok: true,
		request: {
			customerId: raw.customerId,
			period: { from, to },
			projectIds,
			includeTimesheet: raw.includeTimesheet === true,
			locale: isHandOffLocale(raw.locale) ? raw.locale : "en",
		},
	};
}

const hoursOfMinutes = (minutes: number) => formatUnits(BigInt(minutesAsHundredths(minutes)), 2);
const hoursOfMs = (ms: number) => hoursOfMinutes(Math.round(ms / 60_000));

function workView(item: HandOffCandidate): HandOffWorkView {
	return {
		workPeriodId: item.id,
		day: reportedWorkDay(item).toString(),
		employeeName: item.employeeName,
		projectName: item.projectName,
		hours: hoursOfMinutes(item.durationMinutes),
	};
}

async function employeeNames(
	reader: Reader,
	organizationId: string,
	employeeIds: readonly string[],
): Promise<Map<string, string>> {
	if (employeeIds.length === 0) return new Map();
	const rows = await reader
		.select({ id: employee.id, name: user.name })
		.from(employee)
		.innerJoin(user, eq(user.id, employee.userId))
		.where(
			and(eq(employee.organizationId, organizationId), inArray(employee.id, [...employeeIds])),
		);
	return new Map(rows.map((row) => [row.id, row.name]));
}

interface HandOffContext {
	customer: { id: string; name: string };
	projects: { id: string; name: string; selected: boolean }[];
	currency: string;
	enabled: boolean;
	connection: Awaited<ReturnType<typeof getActiveAccountingConnection>>;
	capabilities: AccountingProviderCapabilities | null;
	contact: Awaited<ReturnType<typeof getCustomerContactLink>>;
	taxTreatment: Awaited<ReturnType<typeof getEffectiveCustomerTaxTreatment>>;
	plan: HandOffPlan;
	withoutCustomer: HandOffPreview["withoutCustomer"];
	blockers: HandOffBlockerView[];
	fingerprint: string;
}

/** Loads and plans a hand-off. Null when the customer is not the organization's. */
async function loadHandOffContext(
	reader: Reader,
	dependencies: Pick<AccountingDependencies, "registry">,
	organizationId: string,
	request: HandOffRequest,
	settings: { enabled: boolean; currency: string | null },
): Promise<HandOffContext | { refused: HandOffRequestRefusal }> {
	const [customerRow] = await reader
		.select({ id: customer.id, name: customer.name })
		.from(customer)
		.where(
			and(
				eq(customer.id, request.customerId),
				eq(customer.organizationId, organizationId),
				eq(customer.isActive, true),
			),
		)
		.limit(1);
	if (!customerRow) return { refused: "invalid_customer" };

	const customerProjects = await reader
		.select({ id: project.id, name: project.name })
		.from(project)
		.where(and(eq(project.organizationId, organizationId), eq(project.customerId, customerRow.id)))
		.orderBy(asc(project.name), asc(project.id));
	const known = new Set(customerProjects.map((row) => row.id));
	if (request.projectIds?.some((id) => !known.has(id))) return { refused: "invalid_projects" };
	const selected = new Set(request.projectIds ?? known);
	const range = { fromDay: request.period.from, toDay: request.period.to };

	const work = await loadReportedProjectWork(reader, organizationId, {
		projectIds: [...selected],
		range,
	});
	// Projects without an active customer (none, or a deleted one): their
	// billable work is "without customer" and never in any hand-off.
	const customerless = await reader
		.select({ id: project.id, name: project.name })
		.from(project)
		.where(and(eq(project.organizationId, organizationId), not(projectHasActiveCustomerSql())));
	const customerlessWork = (
		await loadReportedProjectWork(reader, organizationId, {
			projectIds: customerless.map((row) => row.id),
			range,
		})
	).filter((item) => item.isBillable && !item.invoiced);

	const names = await employeeNames(reader, organizationId, [
		...new Set(work.map((item) => item.employeeId)),
	]);
	const projectNames = new Map(customerProjects.map((row) => [row.id, row.name]));
	const candidates: HandOffCandidate[] = work
		.map((item) => ({
			...item,
			employeeName: names.get(item.employeeId) ?? "",
			projectName: projectNames.get(item.projectId) ?? "",
			invoiced: item.invoiced != null,
		}))
		.sort(compareCandidates);
	const rates = await loadReportRates(
		reader,
		organizationId,
		work.filter((item) => item.isBillable && !item.invoiced),
		{ includeCost: false },
	);

	const connection = await getActiveAccountingConnection(reader, organizationId);
	const connector = connection ? dependencies.registry.get(connection.providerKind) : null;
	const capabilities = connector?.capabilities ?? null;
	const [contact, taxTreatment] = await Promise.all([
		getCustomerContactLink(reader, organizationId, customerRow.id),
		getEffectiveCustomerTaxTreatment(reader, organizationId, customerRow.id),
	]);

	const plan = planHandOff({
		period: request.period,
		work: candidates,
		rates: rates.billable,
		texts: handOffTextFormat(request.locale),
		includeTimesheet: request.includeTimesheet,
		maxDraftLines: capabilities?.maxDraftLines ?? null,
	});

	const blockers: HandOffBlockerView[] = [];
	if (!settings.enabled || settings.currency === null) blockers.push({ kind: "billable_time_off" });
	if (!connection) blockers.push({ kind: "not_connected" });
	else if (!capabilities) blockers.push({ kind: "provider_unavailable" });
	if (connection && !contact) blockers.push({ kind: "no_contact_link" });
	blockers.push(...plan.blockers);
	if (capabilities && settings.currency !== null) {
		if (!(capabilities.supportedCurrencies as readonly string[]).includes(settings.currency)) {
			blockers.push({ kind: "currency_not_supported", currency: settings.currency });
		}
		if (taxTreatment && !capabilities.supportedTaxTreatments.includes(taxTreatment.kind)) {
			blockers.push({ kind: "tax_treatment_not_supported", taxTreatment: taxTreatment.kind });
		}
	}

	return {
		customer: customerRow,
		projects: customerProjects.map((row) => ({ ...row, selected: selected.has(row.id) })),
		currency: settings.currency ?? "",
		enabled: settings.enabled,
		connection,
		capabilities,
		contact,
		taxTreatment,
		plan,
		withoutCustomer: {
			count: customerlessWork.length,
			hours: hoursOfMinutes(customerlessWork.reduce((sum, item) => sum + item.durationMinutes, 0)),
			projects: [
				...new Set(
					customerlessWork.map(
						(item) => customerless.find((row) => row.id === item.projectId)?.name ?? "",
					),
				),
			].sort(),
		},
		blockers,
		fingerprint: createHash("sha256")
			.update(
				JSON.stringify({
					customer: customerRow.id,
					period: [request.period.from.toString(), request.period.to.toString()],
					contact: contact?.contactId ?? null,
					tax: taxTreatment ? [taxTreatment.kind, taxTreatment.rateBasisPoints] : null,
					plan: handOffDigestInput(plan),
				}),
			)
			.digest("hex"),
	};
}

function lineViews(plan: HandOffPlan): HandOffLineView[] {
	return [
		...plan.lines.map((line, position) => ({
			position,
			kind: "work" as const,
			projectId: line.projectId,
			projectName: line.projectName,
			text: line.text,
			hours: formatQuantityHours(line),
			rate: formatRate(line.unitPrice),
			amount: formatRate(line.amount),
		})),
		...plan.timesheetLines.map((line, index) => ({
			position: plan.lines.length + index,
			kind: "text" as const,
			projectId: null,
			projectName: null,
			text: line.text,
			hours: null,
			rate: null,
			amount: null,
		})),
	];
}

function previewOf(context: HandOffContext, request: HandOffRequest): HandOffPreview {
	const { plan } = context;
	return {
		customer: context.customer,
		period: { from: request.period.from.toString(), to: request.period.to.toString() },
		projects: context.projects,
		currency: context.currency,
		connection: context.connection && {
			providerKind: context.connection.providerKind,
			accountLabel: context.connection.accountLabel,
			maxDraftLines: context.capabilities?.maxDraftLines ?? null,
		},
		contact: context.contact && {
			contactId: context.contact.contactId,
			contactName: context.contact.contactName,
			contactNumber: context.contact.contactNumber,
		},
		taxTreatment: context.taxTreatment && {
			...taxTreatmentView(context.taxTreatment),
			source: context.taxTreatment.source,
		},
		lines: lineViews(plan),
		netTotal: formatRate(plan.netTotal),
		hours: formatUnits(
			BigInt(plan.lines.reduce((sum, line) => sum + line.quantityHundredths, 0)),
			2,
		),
		included: plan.included.map((item) => workView(item.work)),
		heldBack: plan.heldBack.map(workView),
		alreadyInvoiced: plan.alreadyInvoiced.map(workView),
		unpriced: plan.unpriced.map((item) => ({
			...workView(item.work),
			unpricedHours: hoursOfMs(item.unpricedMs),
		})),
		withoutCustomer: context.withoutCustomer,
		nonBillable: { count: plan.nonBillable.count, hours: hoursOfMinutes(plan.nonBillable.minutes) },
		timesheetLineCount: plan.timesheetLines.length,
		timesheetOmitted: plan.timesheetOmitted,
		blockers: context.blockers,
		fingerprint: context.fingerprint,
	};
}

/** The preview of a hand-off: nothing is written and the tool is not called. */
export async function previewHandOff(
	reader: Reader,
	dependencies: Pick<AccountingDependencies, "registry">,
	input: { organizationId: string; request: HandOffRequest },
): Promise<{ ok: true; preview: HandOffPreview } | { ok: false; reason: HandOffRequestRefusal }> {
	const settings = await getBillableTimeSettings(input.organizationId, reader);
	const context = await loadHandOffContext(
		reader,
		dependencies,
		input.organizationId,
		input.request,
		settings,
	);
	if ("refused" in context) return { ok: false, reason: context.refused };
	return { ok: true, preview: previewOf(context, input.request) };
}

/** Customers the hand-off form offers: active customers with their projects. */
export async function listHandOffCustomers(
	reader: Reader,
	organizationId: string,
): Promise<HandOffCustomerOption[]> {
	const customers = await reader
		.select({ id: customer.id, name: customer.name })
		.from(customer)
		.where(and(eq(customer.organizationId, organizationId), eq(customer.isActive, true)))
		.orderBy(asc(customer.name), asc(customer.id));
	const projects = await reader
		.select({ id: project.id, name: project.name, customerId: project.customerId })
		.from(project)
		.where(eq(project.organizationId, organizationId))
		.orderBy(asc(project.name), asc(project.id));
	const links = await Promise.all(
		customers.map((row) => getCustomerContactLink(reader, organizationId, row.id)),
	);
	return customers.map((row, index) => ({
		id: row.id,
		name: row.name,
		hasContactLink: links[index] !== null,
		projects: projects
			.filter((candidate) => candidate.customerId === row.id)
			.map(({ id, name }) => ({ id, name })),
	}));
}

// ---------------------------------------------------------------------------
// Confirm

export type HandOffRefusal =
	| { reason: "invalid_key" }
	| { reason: HandOffRequestRefusal }
	/** The preview shows why; the first blocker is returned. */
	| { reason: "blocked"; blocker: HandOffBlockerView }
	/** The work changed since the admin's preview: preview again. */
	| { reason: "preview_outdated" }
	/** The key belongs to a hand-off of another customer or period. */
	| { reason: "key_reused" }
	/** The confirm did not carry the preview's fingerprint: preview first. */
	| { reason: "preview_required" }
	/** The draft's accounting account is no longer the active connection. */
	| { reason: "connection_changed" }
	/** The recorded draft no longer fits what the tool declares it takes. */
	| { reason: "draft_does_not_fit"; problem: InvoiceDraftCapabilityProblem }
	/** Another attempt is calling the tool for this draft right now. */
	| { reason: "in_progress"; draftId: string }
	| { reason: "not_connected" | "provider_unavailable" | "credentials_missing" }
	/** The tool did not answer; the draft may exist. Retry: the same key finds it. */
	| { reason: "outcome_unknown"; draftId: string; message: string }
	/** The tool certainly did not create the draft this time; retry later. */
	| { reason: "not_performed"; draftId: string; message: string }
	/** The tool refused the draft; the hand-off failed and its work was returned. */
	| { reason: "rejected"; draftId: string; message: string }
	/** The tool refused the API key. */
	| { reason: "credentials_refused"; draftId: string }
	/** The draft is no longer pending (failed or released). */
	| { reason: "not_pending"; draftId: string; status: InvoiceDraftStatusView }
	| { reason: "not_found" };

export type HandOffOutcome =
	| { ok: true; draftId: string; replayed: boolean }
	| ({ ok: false } & HandOffRefusal);

type DraftRow = typeof invoiceDraft.$inferSelect;

async function lockHandOffs(tx: Pick<Transaction, "execute">, organizationId: string) {
	await tx.execute(
		sql`select pg_advisory_xact_lock(hashtextextended(${`billable_time_hand_off:${organizationId}`}, 0))`,
	);
}

function sameWork(
	row: {
		startTime: Date;
		endTime: Date | null;
		durationMinutes: number | null;
		projectId: string | null;
		isBillable: boolean;
		deletedAt: Date | null;
	},
	item: HandOffCandidate,
): boolean {
	return (
		row.deletedAt === null &&
		row.endTime !== null &&
		row.startTime.getTime() === dateFromInstant(item.startedAt).getTime() &&
		row.endTime.getTime() === dateFromInstant(item.endedAt).getTime() &&
		row.durationMinutes === item.durationMinutes &&
		row.projectId === item.projectId &&
		row.isBillable === item.isBillable
	);
}

/**
 * Records the attempt: the draft (pending), its frozen lines and its invoiced
 * work, in one transaction under the organization's hand-off lock. Returns the
 * existing draft when the key was used before.
 */
async function recordAttempt(
	database: typeof db,
	dependencies: AccountingDependencies,
	input: {
		organizationId: string;
		actorUserId: string;
		request: HandOffRequest;
		idempotencyKey: string;
		expectedFingerprint: string;
	},
): Promise<{ ok: true; draft: DraftRow; created: boolean } | ({ ok: false } & HandOffRefusal)> {
	return database.transaction(async (tx) => {
		const settings = await lockBillableTimeSettings(tx, input.organizationId, "share");
		await lockHandOffs(tx, input.organizationId);

		const [existing] = await tx
			.select()
			.from(invoiceDraft)
			.where(
				and(
					eq(invoiceDraft.organizationId, input.organizationId),
					eq(invoiceDraft.idempotencyKey, input.idempotencyKey),
				),
			)
			.limit(1);
		if (existing) {
			const sameRequest =
				existing.customerId === input.request.customerId &&
				existing.periodFrom === input.request.period.from.toString() &&
				existing.periodTo === input.request.period.to.toString();
			return sameRequest
				? { ok: true, draft: existing, created: false }
				: ({ ok: false, reason: "key_reused" } as const);
		}

		const context = await loadHandOffContext(
			tx,
			dependencies,
			input.organizationId,
			input.request,
			settings,
		);
		if ("refused" in context) return { ok: false, reason: context.refused } as const;
		const [blocker] = context.blockers;
		if (blocker) return { ok: false, reason: "blocked", blocker } as const;
		if (input.expectedFingerprint !== context.fingerprint) {
			return { ok: false, reason: "preview_outdated" } as const;
		}
		const { connection, contact, taxTreatment, plan } = context;
		if (!connection || !contact || !taxTreatment || settings.currency === null) {
			return { ok: false, reason: "blocked", blocker: { kind: "not_connected" } } as const;
		}

		// Hold the included work still while it becomes invoiced work: a writer
		// that changes it waits for this transaction and then marks it.
		const workIds = plan.included.map((item) => item.work.id);
		const locked = await tx
			.select({
				id: workPeriod.id,
				startTime: workPeriod.startTime,
				endTime: workPeriod.endTime,
				durationMinutes: workPeriod.durationMinutes,
				projectId: workPeriod.projectId,
				isBillable: workPeriod.isBillable,
				deletedAt: workPeriod.deletedAt,
			})
			.from(workPeriod)
			.where(
				and(eq(workPeriod.organizationId, input.organizationId), inArray(workPeriod.id, workIds)),
			)
			.for("share");
		const lockedById = new Map(locked.map((row) => [row.id, row]));
		if (
			plan.included.some((item) => {
				const row = lockedById.get(item.work.id);
				return !row || !sameWork(row, item.work);
			})
		) {
			return { ok: false, reason: "preview_outdated" } as const;
		}

		const texts = handOffTextFormat(input.request.locale);
		const [draft] = await tx
			.insert(invoiceDraft)
			.values({
				organizationId: input.organizationId,
				connectionId: connection.id,
				providerKind: connection.providerKind,
				customerId: context.customer.id,
				status: "pending",
				idempotencyKey: input.idempotencyKey,
				contactId: contact.contactId,
				contactName: contact.contactName,
				contactNumber: contact.contactNumber,
				currency: settings.currency,
				taxTreatment: taxTreatment.kind,
				taxRate: formatTaxRate(taxTreatment.rateBasisPoints),
				periodFrom: input.request.period.from.toString(),
				periodTo: input.request.period.to.toString(),
				projectIds: input.request.projectIds,
				title: texts.title,
				introduction: texts.introduction(input.request.period),
				remark: null,
				includeTimesheet: input.request.includeTimesheet,
				netTotal: formatRate(plan.netTotal),
				createdBy: input.actorUserId,
			})
			.returning();

		const lines: (typeof invoiceDraftLine.$inferInsert)[] = [
			...plan.lines.map((line, position) => ({
				organizationId: input.organizationId,
				invoiceDraftId: draft.id,
				position,
				kind: "work" as const,
				projectId: line.projectId,
				projectName: line.projectName,
				text: line.text,
				durationMs: line.durationMs,
				quantityHundredths: line.quantityHundredths,
				unitPrice: formatRate(line.unitPrice),
				amount: formatRate(line.amount),
			})),
			...plan.timesheetLines.map((line, index) => ({
				organizationId: input.organizationId,
				invoiceDraftId: draft.id,
				position: plan.lines.length + index,
				kind: "text" as const,
				text: line.text,
			})),
		];
		await tx.insert(invoiceDraftLine).values(lines);
		await tx.insert(invoicedWork).values(
			plan.included.map((item) => ({
				organizationId: input.organizationId,
				invoiceDraftId: draft.id,
				workPeriodId: item.work.id,
				employeeId: item.work.employeeId,
				projectId: item.work.projectId,
				startedAt: dateFromInstant(item.work.startedAt),
				endedAt: dateFromInstant(item.work.endedAt),
				startOffsetMinutes: item.work.startOffsetMinutes,
				durationMinutes: item.work.durationMinutes,
				shares: item.shares.map(
					(share): InvoicedWorkShare => ({
						line: share.line,
						durationMs: share.durationMs,
						rate: formatRate(share.rate),
						amount: formatRate(share.amount),
					}),
				),
			})),
		);
		// The hand-off started: its work is reserved from now on. No key, no secrets.
		await tx.insert(auditLog).values({
			organizationId: input.organizationId,
			entityType: "invoice_draft",
			entityId: draft.id,
			action: AuditAction.INVOICE_DRAFT_STARTED,
			performedBy: input.actorUserId,
			changes: JSON.stringify({
				...auditDraftChanges(draft),
				projectIds: draft.projectIds,
				includeTimesheet: draft.includeTimesheet,
				workCount: plan.included.length,
			}),
		});
		return { ok: true, draft, created: true };
	});
}

async function draftLines(reader: Reader, draft: DraftRow): Promise<InvoiceDraftLine[]> {
	const rows = await reader
		.select()
		.from(invoiceDraftLine)
		.where(
			and(
				eq(invoiceDraftLine.organizationId, draft.organizationId),
				eq(invoiceDraftLine.invoiceDraftId, draft.id),
			),
		)
		.orderBy(asc(invoiceDraftLine.position));
	return rows.map((row): InvoiceDraftLine => {
		if (row.kind === "text") return { kind: "text", text: row.text };
		return {
			kind: "work",
			projectId: row.projectId ?? "",
			projectName: row.projectName ?? "",
			text: row.text,
			durationMs: row.durationMs ?? 0,
			quantityHundredths: row.quantityHundredths ?? 0,
			unitPrice: rateFromStored(row.unitPrice ?? "0"),
			amount: rateFromStored(row.amount ?? "0"),
		};
	});
}

/** The provider-agnostic draft exactly as the attempt recorded it. */
async function storedInvoiceDraft(reader: Reader, draft: DraftRow): Promise<InvoiceDraft> {
	if (!isBillableCurrency(draft.currency)) throw new RangeError("Not a stored currency");
	return {
		contactId: draft.contactId,
		currency: draft.currency,
		taxTreatment: taxTreatmentFromStored(draft.taxTreatment, draft.taxRate),
		servicePeriod: {
			from: Temporal.PlainDate.from(draft.periodFrom),
			to: Temporal.PlainDate.from(draft.periodTo),
		},
		title: draft.title,
		introduction: draft.introduction,
		remark: draft.remark,
		lines: await draftLines(reader, draft),
	};
}

/**
 * Opens the provider of the account the draft was created for: the active
 * connection, as long as it is to the same tool account (a replaced key of the
 * same account still finds the draft).
 */
async function openDraftProvider(
	reader: Reader,
	dependencies: AccountingDependencies,
	draft: DraftRow,
): Promise<
	| { ok: true; provider: AccountingProvider }
	| {
			ok: false;
			reason:
				| "connection_changed"
				| "not_connected"
				| "provider_unavailable"
				| "credentials_missing";
	  }
> {
	const [draftConnection] = await reader
		.select({ accountRef: accountingConnection.accountRef })
		.from(accountingConnection)
		.where(
			and(
				eq(accountingConnection.id, draft.connectionId),
				eq(accountingConnection.organizationId, draft.organizationId),
			),
		)
		.limit(1);
	const opened = await openAccountingProvider(reader, dependencies, draft.organizationId);
	if (!opened.ok) return { ok: false, reason: opened.reason };
	if (
		opened.connection.providerKind !== draft.providerKind ||
		opened.connection.accountRef !== draftConnection?.accountRef
	) {
		return { ok: false, reason: "connection_changed" };
	}
	return { ok: true, provider: opened.provider };
}

function auditDraftChanges(draft: DraftRow) {
	return {
		customerId: draft.customerId,
		providerKind: draft.providerKind,
		period: { from: draft.periodFrom, to: draft.periodTo },
		currency: draft.currency,
		netTotal: draft.netTotal,
		externalId: draft.externalId,
	};
}

async function returnWork(
	tx: Pick<Transaction, "update">,
	draft: Pick<DraftRow, "id" | "organizationId">,
) {
	return tx
		.update(invoicedWork)
		.set({ releasedAt: sql`now()` })
		.where(
			and(
				eq(invoicedWork.organizationId, draft.organizationId),
				eq(invoicedWork.invoiceDraftId, draft.id),
				isNull(invoicedWork.releasedAt),
			),
		)
		.returning({ id: invoicedWork.id });
}

/** The filter of one draft row, always within its organization. */
function draftRow(draft: Pick<DraftRow, "id" | "organizationId">) {
	return and(eq(invoiceDraft.id, draft.id), eq(invoiceDraft.organizationId, draft.organizationId));
}

/**
 * How long one call may hold a draft. Longer than any provider call with its
 * retries; after it, another attempt may take over (a crashed call never
 * blocks a draft for good).
 */
const CALL_LEASE = sql`interval '10 minutes'`;

/** The right to call the tool for one pending draft, held by one attempt. */
interface CallClaim {
	token: string;
	/** Before this call: whether an earlier call may already have created the draft. */
	previouslyUnknown: boolean;
}

/**
 * Claims the draft for one call under a row lock. Only one call per draft
 * reaches the tool at a time: a concurrent retry or same-key confirm is told the
 * hand-off is in progress. The claim marks the outcome unknown BEFORE the call,
 * so a call that reached the tool but whose answer was never recorded (crash,
 * failed write) keeps the draft from being failed and its work returned.
 */
async function claimCall(
	database: typeof db,
	draft: DraftRow,
): Promise<{ ok: true; claim: CallClaim } | { ok: false; outcome: HandOffOutcome }> {
	return database.transaction(async (tx) => {
		const [current] = await tx
			.select({
				draft: invoiceDraft,
				claimed: sql<boolean>`coalesce(${invoiceDraft.callClaimedUntil} > now(), false)`,
			})
			.from(invoiceDraft)
			.where(draftRow(draft))
			.for("update");
		if (!current) return { ok: false, outcome: { ok: false, reason: "not_found" } } as const;
		const row = current.draft;
		if (row.status === "created") {
			return { ok: false, outcome: { ok: true, draftId: row.id, replayed: true } } as const;
		}
		if (row.status !== "pending") {
			return {
				ok: false,
				outcome: { ok: false, reason: "not_pending", draftId: row.id, status: row.status },
			} as const;
		}
		if (current.claimed) {
			return { ok: false, outcome: { ok: false, reason: "in_progress", draftId: row.id } } as const;
		}
		const token = randomUUID();
		await tx
			.update(invoiceDraft)
			.set({
				callClaimToken: token,
				callClaimedUntil: sql`now() + ${CALL_LEASE}`,
				attemptCount: sql`${invoiceDraft.attemptCount} + 1`,
				lastAttemptAt: sql`now()`,
				outcomeUnknown: true,
			})
			.where(draftRow(row));
		return {
			ok: true,
			// A claim that ran out means an earlier call may still have reached the tool.
			claim: { token, previouslyUnknown: row.outcomeUnknown || row.callClaimToken !== null },
		} as const;
	});
}

const NO_CLAIM = { callClaimToken: null, callClaimedUntil: null } as const;

/** Gives up a claim (best effort) after its outcome could not be recorded. */
async function dropClaim(database: typeof db, draft: DraftRow, claim: CallClaim) {
	try {
		await database
			.update(invoiceDraft)
			.set(NO_CLAIM)
			.where(and(draftRow(draft), eq(invoiceDraft.callClaimToken, claim.token)));
	} catch {
		// The lease runs out on its own.
	}
}

/**
 * Calls the tool for a pending draft with its key and finishes the attempt.
 * Never holds a transaction across the call.
 */
async function callTool(
	database: typeof db,
	dependencies: AccountingDependencies,
	draft: DraftRow,
	actorUserId: string,
): Promise<HandOffOutcome> {
	const opened = await openDraftProvider(database, dependencies, draft);
	if (!opened.ok) return { ok: false, reason: opened.reason };
	const request = await storedInvoiceDraft(database, draft);
	const [problem] = checkInvoiceDraftFits(request, opened.provider.capabilities);
	if (problem) return { ok: false, reason: "draft_does_not_fit", problem };

	const claimed = await claimCall(database, draft);
	if (!claimed.ok) return claimed.outcome;
	const { claim } = claimed;

	let created: Awaited<ReturnType<AccountingProvider["createInvoiceDraft"]>>;
	try {
		created = await opened.provider.createInvoiceDraft(request, {
			idempotencyKey: draft.idempotencyKey,
			firstAttemptAt: instantFromDate(draft.firstAttemptAt),
		});
	} catch (error) {
		try {
			return await failedCall(database, draft, claim, actorUserId, error);
		} catch (recordError) {
			await dropClaim(database, draft, claim);
			throw recordError;
		}
	}

	try {
		return await createdCall(database, draft, created, actorUserId);
	} catch (error) {
		await dropClaim(database, draft, claim);
		throw error;
	}
}

/** Records the draft the tool created. Ends any claim: no further call is needed. */
async function createdCall(
	database: typeof db,
	draft: DraftRow,
	created: Awaited<ReturnType<AccountingProvider["createInvoiceDraft"]>>,
	actorUserId: string,
): Promise<HandOffOutcome> {
	return database.transaction(async (tx) => {
		const [current] = await tx.select().from(invoiceDraft).where(draftRow(draft)).for("update");
		if (!current) return { ok: false, reason: "not_found" } as const;
		if (current.status === "created") {
			// Another attempt recorded it meanwhile (the tool returned the same draft).
			return { ok: true, draftId: current.id, replayed: true } as const;
		}
		if (current.status !== "pending") {
			// Released (or failed) while the tool was answering: keep that state,
			// but remember which draft the tool created.
			await tx
				.update(invoiceDraft)
				.set({ externalId: created.externalId, externalUrl: created.externalUrl, ...NO_CLAIM })
				.where(draftRow(current));
			return {
				ok: false,
				reason: "not_pending",
				draftId: current.id,
				status: current.status,
			} as const;
		}
		const [updated] = await tx
			.update(invoiceDraft)
			.set({
				status: "created",
				externalId: created.externalId,
				externalUrl: created.externalUrl,
				confirmedAt: sql`now()`,
				lastFailure: null,
				lastFailureMessage: null,
				...NO_CLAIM,
			})
			.where(draftRow(current))
			.returning();
		const [{ count }] = await tx
			.select({ count: sql<number>`count(*)::int` })
			.from(invoicedWork)
			.where(
				and(
					eq(invoicedWork.organizationId, current.organizationId),
					eq(invoicedWork.invoiceDraftId, current.id),
				),
			);
		await tx.insert(auditLog).values({
			organizationId: current.organizationId,
			entityType: "invoice_draft",
			entityId: current.id,
			action: AuditAction.INVOICE_DRAFT_CREATED,
			performedBy: actorUserId,
			changes: JSON.stringify({ ...auditDraftChanges(updated), workCount: count }),
			metadata: JSON.stringify({
				attempts: updated.attemptCount,
				outcomeUnknownBefore: current.outcomeUnknown,
			}),
		});
		logger.info(
			{ organizationId: current.organizationId, invoiceDraftId: current.id },
			"Invoice draft created in the accounting tool",
		);
		return { ok: true, draftId: current.id, replayed: false } as const;
	});
}

async function failedCall(
	database: typeof db,
	draft: DraftRow,
	claim: CallClaim,
	actorUserId: string,
	error: unknown,
): Promise<HandOffOutcome> {
	const failure = isAccountingProviderError(error) ? error.failure : "outcome_unknown";
	const message = isAccountingProviderError(error)
		? error.message
		: "The accounting tool call failed unexpectedly";
	if (!isAccountingProviderError(error)) {
		logger.error(
			{ organizationId: draft.organizationId, invoiceDraftId: draft.id },
			"Unexpected error while creating an invoice draft",
		);
	}

	return database.transaction(async (tx) => {
		const [current] = await tx.select().from(invoiceDraft).where(draftRow(draft)).for("update");
		if (!current) return { ok: false, reason: "not_found" } as const;
		const stillMine = current.callClaimToken === claim.token;
		// Unknown when this call may have reached the tool, when an earlier call
		// may have, or when another attempt took the draft over meanwhile.
		const outcomeUnknown = failure === "outcome_unknown" || claim.previouslyUnknown || !stillMine;
		const release = stillMine ? NO_CLAIM : {};
		// A definite refusal ends the attempt only while no call can have created
		// the draft; otherwise it stays pending for a retry or a release.
		const definite = failure === "rejected" || failure === "unauthorized";
		if (definite && !outcomeUnknown && current.status === "pending") {
			const [failed] = await tx
				.update(invoiceDraft)
				.set({
					status: "failed",
					endedAt: sql`now()`,
					endedBy: actorUserId,
					lastFailure: failure,
					lastFailureMessage: message,
					outcomeUnknown: false,
					...release,
				})
				.where(draftRow(current))
				.returning();
			const returned = await returnWork(tx, current);
			await tx.insert(auditLog).values({
				organizationId: current.organizationId,
				entityType: "invoice_draft",
				entityId: current.id,
				action: AuditAction.INVOICE_DRAFT_FAILED,
				performedBy: actorUserId,
				changes: JSON.stringify({
					...auditDraftChanges(failed),
					failure,
					workReturned: returned.length,
				}),
			});
			return failure === "unauthorized"
				? ({ ok: false, reason: "credentials_refused", draftId: current.id } as const)
				: ({ ok: false, reason: "rejected", draftId: current.id, message } as const);
		}
		await tx
			.update(invoiceDraft)
			.set({ outcomeUnknown, lastFailure: failure, lastFailureMessage: message, ...release })
			.where(draftRow(current));
		if (failure === "unauthorized") {
			return { ok: false, reason: "credentials_refused", draftId: current.id } as const;
		}
		return {
			ok: false,
			reason: failure === "not_performed" ? "not_performed" : "outcome_unknown",
			draftId: current.id,
			message,
		} as const;
	});
}

/**
 * Confirms a hand-off: records the attempt, then creates the draft through the
 * provider port. Retrying with the same idempotency key continues the same
 * attempt (it never plans again), so it yields one draft and one set of
 * invoiced work.
 */
export async function confirmHandOff(
	database: typeof db,
	dependencies: AccountingDependencies,
	input: {
		organizationId: string;
		actorUserId: string;
		request: HandOffRequest;
		idempotencyKey: unknown;
		expectedFingerprint: unknown;
	},
): Promise<HandOffOutcome> {
	if (!isUuid(input.idempotencyKey)) {
		return { ok: false, reason: "invalid_key" };
	}
	if (typeof input.expectedFingerprint !== "string" || input.expectedFingerprint === "") {
		return { ok: false, reason: "preview_required" };
	}
	let recorded: Awaited<ReturnType<typeof recordAttempt>>;
	try {
		recorded = await recordAttempt(database, dependencies, {
			organizationId: input.organizationId,
			actorUserId: input.actorUserId,
			request: input.request,
			idempotencyKey: input.idempotencyKey.toLowerCase(),
			expectedFingerprint: input.expectedFingerprint,
		});
	} catch (error) {
		// Another hand-off took some of this work at the same moment.
		if (isUniqueViolation(error)) return { ok: false, reason: "preview_outdated" };
		throw error;
	}
	if (!recorded.ok) return recorded;
	return continueAttempt(database, dependencies, recorded.draft, input.actorUserId);
}

async function continueAttempt(
	database: typeof db,
	dependencies: AccountingDependencies,
	draft: DraftRow,
	actorUserId: string,
): Promise<HandOffOutcome> {
	switch (draft.status) {
		case "created":
			return { ok: true, draftId: draft.id, replayed: true };
		case "failed":
		case "released":
			return { ok: false, reason: "not_pending", draftId: draft.id, status: draft.status };
		case "pending":
			return callTool(database, dependencies, draft, actorUserId);
	}
}

/** Retries a pending hand-off (after a timeout) with its recorded key and lines. */
export async function retryHandOff(
	database: typeof db,
	dependencies: AccountingDependencies,
	input: { organizationId: string; actorUserId: string; draftId: string },
): Promise<HandOffOutcome> {
	const draft = await findDraft(database, input.organizationId, input.draftId);
	if (!draft) return { ok: false, reason: "not_found" };
	return continueAttempt(database, dependencies, draft, input.actorUserId);
}

async function findDraft(
	reader: Reader,
	organizationId: string,
	draftId: string,
): Promise<DraftRow | null> {
	if (!isUuid(draftId)) return null;
	const [row] = await reader
		.select()
		.from(invoiceDraft)
		.where(and(eq(invoiceDraft.id, draftId), eq(invoiceDraft.organizationId, organizationId)))
		.limit(1);
	return row ?? null;
}

// ---------------------------------------------------------------------------
// Release, status check, marks

export type ReleaseOutcome =
	| { ok: true; workReturned: number }
	| { ok: false; reason: "not_found" | "not_releasable" };

/**
 * Releases a draft: its work is un-invoiced again and can be handed off anew.
 * Audited. Z8 never releases on its own, also not when the tool reports the
 * draft as gone.
 */
export async function releaseInvoiceDraft(
	database: typeof db,
	input: { organizationId: string; actorUserId: string; draftId: string; reason: unknown },
): Promise<ReleaseOutcome> {
	if (!isUuid(input.draftId)) return { ok: false, reason: "not_found" };
	const reason =
		typeof input.reason === "string" && input.reason.trim() !== ""
			? input.reason.trim().slice(0, MAX_RELEASE_REASON)
			: null;
	return database.transaction(async (tx) => {
		await lockHandOffs(tx, input.organizationId);
		const [draft] = await tx
			.select()
			.from(invoiceDraft)
			.where(
				and(
					eq(invoiceDraft.id, input.draftId),
					eq(invoiceDraft.organizationId, input.organizationId),
				),
			)
			.for("update");
		if (!draft) return { ok: false, reason: "not_found" } as const;
		if (draft.status !== "pending" && draft.status !== "created") {
			return { ok: false, reason: "not_releasable" } as const;
		}
		await tx
			.update(invoiceDraft)
			.set({
				status: "released",
				endedAt: sql`now()`,
				endedBy: input.actorUserId,
				releaseReason: reason,
			})
			.where(draftRow(draft));
		const returned = await returnWork(tx, draft);
		await tx.insert(auditLog).values({
			organizationId: input.organizationId,
			entityType: "invoice_draft",
			entityId: draft.id,
			action: AuditAction.INVOICE_DRAFT_RELEASED,
			performedBy: input.actorUserId,
			changes: JSON.stringify({
				...auditDraftChanges(draft),
				status: { from: draft.status, to: "released" },
				toolStatus: draft.toolStatus,
				workReturned: returned.length,
				reason,
			}),
		});
		return { ok: true, workReturned: returned.length } as const;
	});
}

/**
 * Asks the tool for a created draft's status (when the provider supports it)
 * and remembers the answer. A draft reported as gone suggests a release; it is
 * never released here.
 */
export async function checkInvoiceDraftStatus(
	database: typeof db,
	dependencies: AccountingDependencies,
	input: { organizationId: string; draftId: string },
): Promise<{ ok: true; status: DraftToolStatusView } | { ok: false; reason: "not_found" }> {
	const draft = await findDraft(database, input.organizationId, input.draftId);
	if (!draft) return { ok: false, reason: "not_found" };
	if (draft.status !== "created" || draft.externalId === null) {
		return { ok: true, status: { kind: "unsupported" } };
	}
	const opened = await openDraftProvider(database, dependencies, draft);
	if (!opened.ok) {
		return {
			ok: true,
			status: {
				kind: "unavailable",
				message:
					opened.reason === "connection_changed"
						? "The draft belongs to another accounting connection"
						: "The accounting tool is not connected",
			},
		};
	}
	if (!opened.provider.capabilities.draftStatusCheck) {
		return { ok: true, status: { kind: "unsupported" } };
	}
	let status: DraftToolStatusView;
	try {
		status = await opened.provider.getInvoiceDraftStatus(draft.externalId);
	} catch (error) {
		return {
			ok: true,
			status: {
				kind: "unavailable",
				message: isAccountingProviderError(error)
					? error.message
					: "The accounting tool could not be asked",
			},
		};
	}
	if (status.kind === "status" || status.kind === "gone") {
		await database
			.update(invoiceDraft)
			.set({
				toolStatus: status.kind === "gone" ? "gone" : status.status,
				toolStatusCheckedAt: sql`now()`,
			})
			.where(
				and(eq(invoiceDraft.id, draft.id), eq(invoiceDraft.organizationId, draft.organizationId)),
			);
	}
	return { ok: true, status };
}

/** Clears changed-after-invoicing marks. Audited per work period. */
export async function clearChangedAfterInvoicing(
	database: typeof db,
	input: { organizationId: string; actorUserId: string; invoicedWorkIds: unknown },
): Promise<{ ok: true; cleared: number } | { ok: false; reason: "invalid_input" }> {
	const ids = input.invoicedWorkIds;
	if (
		!Array.isArray(ids) ||
		ids.length === 0 ||
		ids.length > 1000 ||
		!ids.every((id) => isUuid(id))
	) {
		return { ok: false, reason: "invalid_input" };
	}
	return database.transaction(async (tx) => {
		const marked = await tx
			.select()
			.from(invoicedWork)
			.where(
				and(
					eq(invoicedWork.organizationId, input.organizationId),
					inArray(invoicedWork.id, ids as string[]),
					isNull(invoicedWork.releasedAt),
					sql`${invoicedWork.changedAfterInvoicingAt} is not null`,
				),
			)
			.for("update");
		if (marked.length === 0) return { ok: true, cleared: 0 } as const;
		await tx
			.update(invoicedWork)
			.set({
				changedAfterInvoicingAt: null,
				changedFields: sql`'{}'::text[]`,
				markClearedAt: sql`now()`,
				markClearedBy: input.actorUserId,
			})
			.where(
				and(
					eq(invoicedWork.organizationId, input.organizationId),
					inArray(
						invoicedWork.id,
						marked.map((row) => row.id),
					),
				),
			);
		await tx.insert(auditLog).values(
			marked.map((row) => ({
				organizationId: input.organizationId,
				entityType: "invoiced_work",
				entityId: row.workPeriodId,
				action: AuditAction.INVOICED_WORK_MARK_CLEARED,
				performedBy: input.actorUserId,
				employeeId: row.employeeId,
				changes: JSON.stringify({
					invoiceDraftId: row.invoiceDraftId,
					changedFields: row.changedFields,
					changedAfterInvoicingAt: row.changedAfterInvoicingAt?.toISOString() ?? null,
				}),
			})),
		);
		return { ok: true, cleared: marked.length } as const;
	});
}

// ---------------------------------------------------------------------------
// Reading drafts

function summaryOf(
	row: DraftRow,
	extra: {
		customerName: string;
		createdByName: string | null;
		workCount: number;
		changedCount: number;
	},
): InvoiceDraftSummaryView {
	if (!isAccountingProviderKind(row.providerKind)) {
		throw new RangeError(`Not a stored provider kind: ${row.providerKind}`);
	}
	return {
		id: row.id,
		customerId: row.customerId,
		customerName: extra.customerName,
		providerKind: row.providerKind,
		status: row.status,
		period: { from: row.periodFrom, to: row.periodTo },
		currency: row.currency,
		netTotal: row.netTotal,
		externalId: row.externalId,
		externalUrl: row.externalUrl,
		createdAt: row.createdAt.toISOString(),
		createdByName: extra.createdByName,
		workCount: extra.workCount,
		changedCount: extra.changedCount,
		outcomeUnknown: row.outcomeUnknown,
		lastFailureMessage: row.lastFailureMessage,
		toolStatus: row.toolStatus,
		toolStatusCheckedAt: row.toolStatusCheckedAt?.toISOString() ?? null,
	};
}

const workCountSql = sql<number>`(
	select count(*)::int from ${invoicedWork}
	where ${invoicedWork.organizationId} = ${invoiceDraft.organizationId}
		and ${invoicedWork.invoiceDraftId} = ${invoiceDraft.id}
		and ${invoicedWork.carriedFromWorkPeriodId} is null
)`;
const changedCountSql = sql<number>`(
	select count(*)::int from ${invoicedWork}
	where ${invoicedWork.organizationId} = ${invoiceDraft.organizationId}
		and ${invoicedWork.invoiceDraftId} = ${invoiceDraft.id}
		and ${invoicedWork.releasedAt} is null
		and ${invoicedWork.changedAfterInvoicingAt} is not null
)`;

/** The organization's hand-offs, newest first. */
export async function listInvoiceDrafts(
	reader: Reader,
	organizationId: string,
	options: { limit?: number } = {},
): Promise<InvoiceDraftSummaryView[]> {
	const rows = await reader
		.select({
			draft: invoiceDraft,
			customerName: customer.name,
			createdByName: user.name,
			workCount: workCountSql,
			changedCount: changedCountSql,
		})
		.from(invoiceDraft)
		.innerJoin(
			customer,
			and(eq(customer.id, invoiceDraft.customerId), eq(customer.organizationId, organizationId)),
		)
		.leftJoin(user, eq(user.id, invoiceDraft.createdBy))
		.where(eq(invoiceDraft.organizationId, organizationId))
		.orderBy(desc(invoiceDraft.createdAt), desc(invoiceDraft.id))
		.limit(options.limit ?? 200);
	return rows.map((row) => summaryOf(row.draft, row));
}

function localTime(instant: Date, offsetMinutes: number): string {
	const time = instantFromDate(instant)
		.toZonedDateTimeISO(offsetMinutesToTimeZoneId(offsetMinutes))
		.toPlainTime();
	return `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`;
}

function changedFieldsOf(values: readonly string[]): ChangedField[] {
	const known: readonly string[] = ["times", "project", "billability", "removed", "split"];
	return values.filter((value): value is ChangedField => known.includes(value));
}

/** Invoiced work rows with names, for a draft or for all marked work. */
async function invoicedWorkViews(
	reader: Reader,
	organizationId: string,
	condition: ReturnType<typeof and>,
): Promise<(InvoicedWorkView & { invoiceDraftId: string; timesheet: TimesheetRowView | null })[]> {
	const rows = await reader
		.select({
			work: invoicedWork,
			employeeName: user.name,
			projectName: project.name,
		})
		.from(invoicedWork)
		.innerJoin(
			employee,
			and(eq(employee.id, invoicedWork.employeeId), eq(employee.organizationId, organizationId)),
		)
		.innerJoin(user, eq(user.id, employee.userId))
		.leftJoin(
			project,
			and(eq(project.id, invoicedWork.projectId), eq(project.organizationId, organizationId)),
		)
		.where(and(eq(invoicedWork.organizationId, organizationId), condition))
		.orderBy(asc(invoicedWork.startedAt), asc(invoicedWork.id));
	return rows.map(({ work, employeeName, projectName }) => {
		const day = instantFromDate(work.startedAt)
			.toZonedDateTimeISO(offsetMinutesToTimeZoneId(work.startOffsetMinutes))
			.toPlainDate()
			.toString();
		const hours = hoursOfMinutes(work.durationMinutes);
		return {
			invoicedWorkId: work.id,
			invoiceDraftId: work.invoiceDraftId,
			workPeriodId: work.workPeriodId,
			day,
			employeeName,
			projectName: projectName ?? "",
			hours,
			carried: work.carriedFromWorkPeriodId !== null,
			changedAfterInvoicingAt:
				work.releasedAt === null ? (work.changedAfterInvoicingAt?.toISOString() ?? null) : null,
			changedFields: work.releasedAt === null ? changedFieldsOf(work.changedFields) : [],
			timesheet:
				work.carriedFromWorkPeriodId === null
					? {
							day,
							employeeName,
							projectName: projectName ?? "",
							start: localTime(work.startedAt, work.startOffsetMinutes),
							end: localTime(work.endedAt, work.startOffsetMinutes),
							hours,
						}
					: null,
		};
	});
}

/** One hand-off with its lines, work, marks and timesheet. */
export async function getInvoiceDraftDetail(
	reader: Reader,
	dependencies: Pick<AccountingDependencies, "registry">,
	input: { organizationId: string; draftId: string },
): Promise<InvoiceDraftDetailView | null> {
	if (!isUuid(input.draftId)) return null;
	const [row] = await reader
		.select({
			draft: invoiceDraft,
			customerName: customer.name,
			createdByName: user.name,
			workCount: workCountSql,
			changedCount: changedCountSql,
		})
		.from(invoiceDraft)
		.innerJoin(
			customer,
			and(
				eq(customer.id, invoiceDraft.customerId),
				eq(customer.organizationId, input.organizationId),
			),
		)
		.leftJoin(user, eq(user.id, invoiceDraft.createdBy))
		.where(
			and(
				eq(invoiceDraft.id, input.draftId),
				eq(invoiceDraft.organizationId, input.organizationId),
			),
		)
		.limit(1);
	if (!row) return null;
	const draft = row.draft;
	const lines = await reader
		.select()
		.from(invoiceDraftLine)
		.where(
			and(
				eq(invoiceDraftLine.organizationId, input.organizationId),
				eq(invoiceDraftLine.invoiceDraftId, draft.id),
			),
		)
		.orderBy(asc(invoiceDraftLine.position));
	const work = await invoicedWorkViews(
		reader,
		input.organizationId,
		eq(invoicedWork.invoiceDraftId, draft.id),
	);
	const connection = await getActiveAccountingConnection(reader, input.organizationId);
	const connector =
		connection && isAccountingProviderKind(draft.providerKind)
			? dependencies.registry.get(draft.providerKind)
			: null;
	return {
		...summaryOf(draft, row),
		contactName: draft.contactName,
		contactNumber: draft.contactNumber,
		taxTreatment: taxTreatmentView(taxTreatmentFromStored(draft.taxTreatment, draft.taxRate)),
		title: draft.title,
		introduction: draft.introduction,
		includeTimesheet: draft.includeTimesheet,
		lines: lines.map((line) => ({
			position: line.position,
			kind: line.kind,
			projectId: line.projectId,
			projectName: line.projectName,
			text: line.text,
			hours:
				line.quantityHundredths === null ? null : formatUnits(BigInt(line.quantityHundredths), 2),
			rate: line.unitPrice,
			amount: line.amount,
		})),
		work: work.map(({ timesheet: _timesheet, invoiceDraftId: _draftId, ...view }) => view),
		timesheet: work.flatMap((item) => (item.timesheet ? [item.timesheet] : [])),
		releaseReason: draft.releaseReason,
		endedAt: draft.endedAt?.toISOString() ?? null,
		statusCheckSupported:
			connection?.providerKind === draft.providerKind &&
			(connector?.capabilities.draftStatusCheck ?? false),
	};
}

/** Invoiced work marked as changed after invoicing, across all drafts. */
export async function listChangedAfterInvoicing(
	reader: Reader,
	organizationId: string,
): Promise<(InvoicedWorkView & { invoiceDraftId: string })[]> {
	const rows = await invoicedWorkViews(
		reader,
		organizationId,
		and(isNull(invoicedWork.releasedAt), sql`${invoicedWork.changedAfterInvoicingAt} is not null`),
	);
	return rows.map(({ timesheet: _timesheet, ...view }) => view);
}
