/**
 * Report share links (#806): create, list, revoke and open them, and keep
 * them honest. Project report access (`reports/project-report-access.ts`) is
 * the single source of truth both for who may create a link and for whether a
 * link still lives: a link is revoked as soon as its creator can no longer see
 * every project in it, at the latest when someone opens it.
 *
 * Every query is scoped to the link's organization, except the token lookup,
 * which finds the organization from the token itself.
 */

import "server-only";

import { and, count, desc, eq, inArray, isNull, lte, max, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Effect } from "effect";
import { Temporal } from "temporal-polyfill";
import type { db } from "@/db";
import { organization, user } from "@/db/auth-schema";
import {
	customer,
	employee,
	project,
	type ReportShareLinkRevokeReason,
	reportShareLink,
	reportShareLinkView,
} from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { type AuditTrail, withAuditTrail } from "@/lib/audit-trail";
import { dateFromInstant, instantFromDate } from "@/lib/datetime/temporal-core";
import { AuthorizationError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { loadProjectReportViewer } from "@/lib/reports/project-billable-report";
import {
	billableFiguresAccessFor,
	canViewProjectReport,
	type ProjectReportViewer,
} from "@/lib/reports/project-report-access";
import {
	readCustomerBillableReport,
	readProjectDetailedReport,
} from "@/lib/reports/project-report-readers";
import { reportDayRangeFromDays } from "@/lib/reports/project-report-work";
import { ALL_LANGUAGES, DEFAULT_LANGUAGE } from "@/tolgee/shared";
import { shareLinkExpiry } from "./share-link-expiry";
import { shareLinkPath } from "./share-link-path";
import {
	digestShareLinkToken,
	generateShareLinkToken,
	isWellFormedShareLinkToken,
	SHARE_LINK_TOKEN_HASH_VERSION,
	shareLinkTokenMatches,
} from "./share-link-token";
import {
	type SharedSnapshot,
	type ShareLinkFigures,
	takeCustomerSnapshot,
	takeProjectSnapshot,
} from "./shared-snapshot";

type DatabaseClient = typeof db;
type Transaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];
type Client = DatabaseClient | Transaction;
type LinkRow = typeof reportShareLink.$inferSelect;

export type ShareTarget =
	| { kind: "project"; projectId: string }
	| { kind: "customer"; customerId: string };

export interface RequestContext {
	ipAddress?: string | null;
	userAgent?: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SHARE_PERMISSION_MESSAGE = "You don't have permission to share this report";

function isPastExpiry(link: Pick<LinkRow, "expiresAt">, now: Temporal.Instant): boolean {
	return Temporal.Instant.compare(instantFromDate(link.expiresAt), now) <= 0;
}

// ============================================
// ACCESS
// ============================================

/** Whether a creator who sees reports as `viewer` sees every project of the link. */
export function linkProjectsVisible(
	viewer: ProjectReportViewer,
	link: Pick<LinkRow, "kind" | "projectIds">,
): boolean {
	// The customer view is for owners, admins and the managers of its projects.
	const sees = (projectId: string) =>
		link.kind === "project"
			? canViewProjectReport(viewer, projectId)
			: viewer.isOrganizationAdmin || viewer.managedProjectIds.has(projectId);
	return link.projectIds.every(sees);
}

/** The creator's report access now; null once they are no active employee of the organization. */
async function creatorViewer(
	client: Client,
	link: Pick<LinkRow, "organizationId" | "createdBy" | "creatorEmployeeId">,
): Promise<ProjectReportViewer | null> {
	if (!link.creatorEmployeeId) return null;
	const [creator] = await client
		.select({ id: employee.id, role: employee.role })
		.from(employee)
		.where(
			and(
				eq(employee.id, link.creatorEmployeeId),
				eq(employee.organizationId, link.organizationId),
				eq(employee.userId, link.createdBy),
				eq(employee.isActive, true),
			),
		)
		.limit(1);
	if (!creator) return null;
	return loadProjectReportViewer(client, {
		organizationId: link.organizationId,
		userId: link.createdBy,
		employee: creator,
	});
}

async function creatorSeesEveryProject(client: Client, link: LinkRow): Promise<boolean> {
	const viewer = await creatorViewer(client, link);
	return viewer !== null && linkProjectsVisible(viewer, link);
}

// ============================================
// REVOCATION
// ============================================

/**
 * Revokes a live link and deletes its snapshot, with its audit entry, in the
 * caller's transaction. False when the link was no longer live.
 */
async function markRevoked(
	tx: Transaction,
	audit: AuditTrail,
	link: LinkRow,
	input: {
		reason: Exclude<ReportShareLinkRevokeReason, "expired">;
		revokedBy: string | null;
		now: Temporal.Instant;
		request?: RequestContext;
	},
): Promise<boolean> {
	const [revoked] = await tx
		.update(reportShareLink)
		.set({
			revokedAt: dateFromInstant(input.now),
			revokedBy: input.revokedBy,
			revokeReason: input.reason,
			snapshot: null,
		})
		.where(
			and(
				eq(reportShareLink.id, link.id),
				eq(reportShareLink.organizationId, link.organizationId),
				isNull(reportShareLink.revokedAt),
			),
		)
		.returning({ id: reportShareLink.id });
	if (!revoked) return false;
	await audit.record(tx, {
		organizationId: link.organizationId,
		action:
			input.reason === "manual"
				? AuditAction.REPORT_SHARE_LINK_REVOKED
				: AuditAction.REPORT_SHARE_LINK_AUTO_REVOKED,
		// The audit log needs a user: an automatic revocation nobody acted for is the creator's link.
		actorUserId: input.revokedBy ?? link.createdBy,
		targetType: "report_share_link",
		targetId: link.id,
		metadata: {
			reason: input.reason,
			automatic: input.reason !== "manual",
			kind: link.kind,
			projectIds: link.projectIds,
			customerId: link.customerId,
		},
		ipAddress: input.request?.ipAddress ?? null,
		userAgent: input.request?.userAgent ?? null,
	});
	return true;
}

/**
 * Revokes every live link of `scope` whose creator no longer sees every
 * project in it. `actorUserId` is whoever's change took the access away, when
 * known. Returns how many links were revoked.
 */
export async function revokeShareLinksCreatorsCannotSee(
	client: DatabaseClient,
	scope: {
		organizationId?: string;
		creatorUserId?: string;
		creatorEmployeeId?: string;
		actorUserId?: string | null;
		now: Temporal.Instant;
	},
): Promise<number> {
	const conditions: SQL[] = [
		isNull(reportShareLink.revokedAt),
		sql`${reportShareLink.expiresAt} > ${dateFromInstant(scope.now)}`,
	];
	if (scope.organizationId)
		conditions.push(eq(reportShareLink.organizationId, scope.organizationId));
	if (scope.creatorUserId) conditions.push(eq(reportShareLink.createdBy, scope.creatorUserId));
	if (scope.creatorEmployeeId) {
		conditions.push(eq(reportShareLink.creatorEmployeeId, scope.creatorEmployeeId));
	}
	const links = await client
		.select()
		.from(reportShareLink)
		.where(and(...conditions));

	const viewers = new Map<string, Promise<ProjectReportViewer | null>>();
	const lost: LinkRow[] = [];
	for (const link of links) {
		const key = `${link.organizationId}:${link.createdBy}:${link.creatorEmployeeId}`;
		let viewer = viewers.get(key);
		if (!viewer) {
			viewer = creatorViewer(client, link);
			viewers.set(key, viewer);
		}
		const current = await viewer;
		if (current === null || !linkProjectsVisible(current, link)) lost.push(link);
	}
	if (lost.length === 0) return 0;

	return withAuditTrail(async (audit) => {
		let revoked = 0;
		await client.transaction(async (tx) => {
			for (const link of lost) {
				const done = await markRevoked(tx, audit, link, {
					reason: "creator_lost_access",
					revokedBy: scope.actorUserId ?? null,
					now: scope.now,
				});
				if (done) revoked++;
			}
		});
		return revoked;
	});
}

/**
 * Marks every live link past its expiry as expired and deletes its snapshot;
 * only `link` (within its organization) when given.
 */
export async function expireShareLinks(
	client: DatabaseClient,
	input: { now: Temporal.Instant; link?: Pick<LinkRow, "id" | "organizationId"> },
): Promise<number> {
	const expired = await client
		.update(reportShareLink)
		.set({
			revokedAt: sql`${reportShareLink.expiresAt}`,
			revokeReason: "expired",
			snapshot: null,
		})
		.where(
			and(
				isNull(reportShareLink.revokedAt),
				lte(reportShareLink.expiresAt, dateFromInstant(input.now)),
				...(input.link
					? [
							eq(reportShareLink.id, input.link.id),
							eq(reportShareLink.organizationId, input.link.organizationId),
						]
					: []),
			),
		)
		.returning({ id: reportShareLink.id });
	return expired.length;
}

/** The share links sweep: expiries and creators who lost access, in every organization. */
export async function sweepShareLinks(
	client: DatabaseClient,
	input: { now: Temporal.Instant },
): Promise<{ expired: number; creatorLostAccess: number }> {
	const expired = await expireShareLinks(client, input);
	const creatorLostAccess = await revokeShareLinksCreatorsCannotSee(client, input);
	return { expired, creatorLostAccess };
}

/** Deletes recipient views older than the audit-log lifetime. */
export async function deleteShareLinkViewsPastAuditLifetime(
	client: DatabaseClient,
	input: { now: Temporal.Instant; lifetimeDays: number },
): Promise<number> {
	const cutoff = input.now.subtract({ hours: input.lifetimeDays * 24 });
	const deleted = await client
		.delete(reportShareLinkView)
		.where(sql`${reportShareLinkView.viewedAt} < ${dateFromInstant(cutoff)}`)
		.returning({ id: reportShareLinkView.id });
	return deleted.length;
}

export type RevokeShareLinkResult = { ok: true } | { ok: false; reason: "not_found" | "forbidden" };

/** A manual revocation by the link's creator or an owner or admin of its organization. */
export async function revokeShareLink(
	client: DatabaseClient,
	input: {
		organizationId: string;
		linkId: string;
		actor: { userId: string; isOrganizationAdmin: boolean };
		now: Temporal.Instant;
		request?: RequestContext;
	},
): Promise<RevokeShareLinkResult> {
	if (!UUID.test(input.linkId)) return { ok: false, reason: "not_found" };
	const [link] = await client
		.select()
		.from(reportShareLink)
		.where(
			and(
				eq(reportShareLink.id, input.linkId),
				eq(reportShareLink.organizationId, input.organizationId),
			),
		)
		.limit(1);
	if (!link) return { ok: false, reason: "not_found" };
	if (link.createdBy !== input.actor.userId && !input.actor.isOrganizationAdmin) {
		return { ok: false, reason: "forbidden" };
	}
	// A link past its expiry already stopped: it is recorded as expired, not revoked.
	if (isPastExpiry(link, input.now)) {
		await expireShareLinks(client, { now: input.now, link });
		return { ok: true };
	}
	await withAuditTrail((audit) =>
		client.transaction((tx) =>
			markRevoked(tx, audit, link, {
				reason: "manual",
				revokedBy: input.actor.userId,
				now: input.now,
				request: input.request,
			}),
		),
	);
	return { ok: true };
}

// ============================================
// CREATION
// ============================================

export interface CreateShareLinkInput {
	organizationId: string;
	creator: { userId: string; employeeId: string };
	viewer: ProjectReportViewer;
	target: ShareTarget;
	fromDay: string;
	toDay: string;
	figures: ShareLinkFigures;
	/** Project links only; customer links never have an employee breakdown. */
	includeEmployees: boolean;
	/** Omitted: the default; null: a permanent link, which is refused. */
	expiresInDays?: number | null;
	creatorLocale: string;
	now: Temporal.Instant;
	request?: RequestContext;
}

export interface CreatedShareLink {
	id: string;
	/** `/share/<token>`; shown once and never readable again. */
	path: string;
	expiresAt: string;
}

/**
 * Computes the report once under the creator's access, stores its shared
 * snapshot behind a new token and audits the creation.
 */
export function createShareLink(input: CreateShareLinkInput) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const expiry = shareLinkExpiry({ createdAt: input.now, expiresInDays: input.expiresInDays });
		if (!expiry.ok) {
			return yield* Effect.fail(
				new ValidationError({
					message:
						expiry.reason === "no_expiry"
							? "Every share link expires; choose an expiry"
							: expiry.reason === "too_long"
								? "A share link expires after at most 90 days"
								: "Choose an expiry of whole days",
					field: "expiresInDays",
				}),
			);
		}
		if (input.figures !== "hours" && input.figures !== "revenue") {
			return yield* Effect.fail(
				new ValidationError({ message: "Choose which figures to share", field: "figures" }),
			);
		}
		const range = reportDayRangeFromDays(input.fromDay, input.toDay);
		if (!range) {
			return yield* Effect.fail(
				new ValidationError({
					message: "Choose a period whose end is not before its start",
					field: "period",
				}),
			);
		}

		let snapshot: SharedSnapshot;
		let projectIds: string[];
		if (input.target.kind === "project") {
			const { projectId } = input.target;
			if (!UUID.test(projectId) || !canViewProjectReport(input.viewer, projectId)) {
				return yield* Effect.fail(new AuthorizationError({ message: SHARE_PERMISSION_MESSAGE }));
			}
			if (
				input.figures === "revenue" &&
				billableFiguresAccessFor(input.viewer, projectId) === null
			) {
				return yield* Effect.fail(
					new AuthorizationError({
						message: "You don't have permission to share this project's revenue",
					}),
				);
			}
			const report = yield* readProjectDetailedReport({
				organizationId: input.organizationId,
				readerUserId: input.creator.userId,
				viewer: input.viewer,
				projectId,
				range,
			});
			if (input.figures === "revenue" && !report.billableTime) {
				return yield* Effect.fail(
					new ValidationError({
						message: "Billable Time is not enabled for this organization",
						field: "figures",
					}),
				);
			}
			snapshot = takeProjectSnapshot(report, {
				figures: input.figures,
				includeEmployees: input.includeEmployees === true,
			});
			projectIds = [projectId];
		} else {
			const { customerId } = input.target;
			const viewer = input.viewer;
			if (!viewer.isOrganizationAdmin && viewer.managedProjectIds.size === 0) {
				return yield* Effect.fail(new AuthorizationError({ message: SHARE_PERMISSION_MESSAGE }));
			}
			const [sharedCustomer] = UUID.test(customerId)
				? yield* dbService.query("reportShareLink.getCustomer", () =>
						dbService.db
							.select({ id: customer.id, name: customer.name })
							.from(customer)
							.where(
								and(
									eq(customer.id, customerId),
									eq(customer.organizationId, input.organizationId),
									eq(customer.isActive, true),
								),
							)
							.limit(1),
					)
				: [];
			if (!sharedCustomer) {
				return yield* Effect.fail(
					new NotFoundError({ message: "Customer not found", entityType: "customer" }),
				);
			}
			const customerView = yield* readCustomerBillableReport({
				organizationId: input.organizationId,
				viewer,
				range,
				customerId,
			});
			if (customerView.projectIds.length === 0) {
				return yield* Effect.fail(
					viewer.isOrganizationAdmin
						? new ValidationError({ message: "This customer has no projects to share" })
						: new AuthorizationError({ message: SHARE_PERMISSION_MESSAGE }),
				);
			}
			snapshot = takeCustomerSnapshot(customerView.report, {
				customer: sharedCustomer,
				figures: input.figures,
			});
			projectIds = customerView.projectIds;
		}

		const token = generateShareLinkToken();
		const values: typeof reportShareLink.$inferInsert = {
			organizationId: input.organizationId,
			createdBy: input.creator.userId,
			creatorEmployeeId: input.creator.employeeId,
			kind: input.target.kind,
			projectId: input.target.kind === "project" ? input.target.projectId : null,
			customerId: input.target.kind === "customer" ? input.target.customerId : null,
			projectIds,
			fromDay: range.fromDay.toString(),
			toDay: range.toDay.toString(),
			figures: input.figures,
			includeEmployees: input.target.kind === "project" && input.includeEmployees === true,
			creatorLocale: ALL_LANGUAGES.includes(input.creatorLocale)
				? input.creatorLocale
				: DEFAULT_LANGUAGE,
			tokenDigest: digestShareLinkToken(token),
			tokenHashVersion: SHARE_LINK_TOKEN_HASH_VERSION,
			snapshot,
			createdAt: dateFromInstant(input.now),
			expiresAt: dateFromInstant(expiry.expiresAt),
		};
		const id = yield* dbService.query("reportShareLink.create", () =>
			withAuditTrail((audit) =>
				dbService.db.transaction(async (tx) => {
					const [created] = await tx
						.insert(reportShareLink)
						.values(values)
						.returning({ id: reportShareLink.id });
					if (!created) throw new Error("Report share link was not created");
					await audit.record(tx, {
						organizationId: input.organizationId,
						action: AuditAction.REPORT_SHARE_LINK_CREATED,
						actorUserId: input.creator.userId,
						targetType: "report_share_link",
						targetId: created.id,
						employeeId: input.creator.employeeId,
						metadata: {
							kind: values.kind,
							projectId: values.projectId,
							customerId: values.customerId,
							projectIds,
							fromDay: values.fromDay,
							toDay: values.toDay,
							figures: values.figures,
							includeEmployees: values.includeEmployees,
							expiresAt: expiry.expiresAt.toString(),
						},
						ipAddress: input.request?.ipAddress ?? null,
						userAgent: input.request?.userAgent ?? null,
					});
					return created.id;
				}),
			),
		);
		return {
			id,
			path: shareLinkPath(token),
			expiresAt: expiry.expiresAt.toString(),
		} satisfies CreatedShareLink;
	});
}

// ============================================
// LISTS
// ============================================

export type ShareLinkStatus = "active" | "expired" | "revoked";

export interface ShareLinkSummary {
	id: string;
	kind: "project" | "customer";
	/** The project's or customer's current name; null once it is deleted. */
	reportName: string | null;
	projectId: string | null;
	customerId: string | null;
	fromDay: string;
	toDay: string;
	figures: ShareLinkFigures;
	includeEmployees: boolean;
	createdAt: string;
	expiresAt: string;
	createdBy: { userId: string; name: string };
	status: ShareLinkStatus;
	revokedAt: string | null;
	revokeReason: ReportShareLinkRevokeReason | null;
	revokedByName: string | null;
	viewCount: number;
	lastViewedAt: string | null;
	/** Whether the reader may revoke it: its creator, or an owner or admin. */
	canRevoke: boolean;
}

export interface ShareLinkReader {
	userId: string;
	isOrganizationAdmin: boolean;
}

function linkStatus(
	link: Pick<LinkRow, "revokedAt" | "revokeReason" | "expiresAt">,
	now: Temporal.Instant,
): ShareLinkStatus {
	if (link.revokedAt) return link.revokeReason === "expired" ? "expired" : "revoked";
	return isPastExpiry(link, now) ? "expired" : "active";
}

/**
 * The organization's links a reader may see: every link for owners and
 * admins, their own links for everyone else; optionally one report's only.
 */
export async function listShareLinks(
	client: DatabaseClient,
	input: {
		organizationId: string;
		reader: ShareLinkReader;
		target?: ShareTarget;
		now: Temporal.Instant;
	},
): Promise<ShareLinkSummary[]> {
	const creator = alias(user, "creator");
	const revoker = alias(user, "revoker");
	const conditions: SQL[] = [eq(reportShareLink.organizationId, input.organizationId)];
	if (!input.reader.isOrganizationAdmin) {
		conditions.push(eq(reportShareLink.createdBy, input.reader.userId));
	}
	if (input.target?.kind === "project") {
		if (!UUID.test(input.target.projectId)) return [];
		conditions.push(
			eq(reportShareLink.kind, "project"),
			eq(reportShareLink.projectId, input.target.projectId),
		);
	} else if (input.target?.kind === "customer") {
		if (!UUID.test(input.target.customerId)) return [];
		conditions.push(
			eq(reportShareLink.kind, "customer"),
			eq(reportShareLink.customerId, input.target.customerId),
		);
	}
	const rows = await client
		.select({
			link: {
				id: reportShareLink.id,
				kind: reportShareLink.kind,
				projectId: reportShareLink.projectId,
				customerId: reportShareLink.customerId,
				fromDay: reportShareLink.fromDay,
				toDay: reportShareLink.toDay,
				figures: reportShareLink.figures,
				includeEmployees: reportShareLink.includeEmployees,
				createdAt: reportShareLink.createdAt,
				createdBy: reportShareLink.createdBy,
				expiresAt: reportShareLink.expiresAt,
				revokedAt: reportShareLink.revokedAt,
				revokeReason: reportShareLink.revokeReason,
			},
			projectName: project.name,
			customerName: customer.name,
			creatorName: creator.name,
			revokerName: revoker.name,
		})
		.from(reportShareLink)
		.leftJoin(
			project,
			and(
				eq(project.id, reportShareLink.projectId),
				eq(project.organizationId, reportShareLink.organizationId),
			),
		)
		.leftJoin(
			customer,
			and(
				eq(customer.id, reportShareLink.customerId),
				eq(customer.organizationId, reportShareLink.organizationId),
			),
		)
		.innerJoin(creator, eq(creator.id, reportShareLink.createdBy))
		.leftJoin(revoker, eq(revoker.id, reportShareLink.revokedBy))
		.where(and(...conditions))
		.orderBy(desc(reportShareLink.createdAt))
		.limit(500);

	const linkIds = rows.map((row) => row.link.id);
	const views =
		linkIds.length === 0
			? []
			: await client
					.select({
						linkId: reportShareLinkView.linkId,
						viewCount: count(),
						lastViewedAt: max(reportShareLinkView.viewedAt),
					})
					.from(reportShareLinkView)
					.where(
						and(
							eq(reportShareLinkView.organizationId, input.organizationId),
							inArray(reportShareLinkView.linkId, linkIds),
						),
					)
					.groupBy(reportShareLinkView.linkId);
	const viewsByLink = new Map(views.map((row) => [row.linkId, row]));

	return rows.map(({ link, projectName, customerName, creatorName, revokerName }) => {
		const viewed = viewsByLink.get(link.id);
		return {
			id: link.id,
			kind: link.kind,
			reportName: link.kind === "project" ? projectName : customerName,
			projectId: link.projectId,
			customerId: link.customerId,
			fromDay: link.fromDay,
			toDay: link.toDay,
			figures: link.figures,
			includeEmployees: link.includeEmployees,
			createdAt: instantFromDate(link.createdAt).toString(),
			expiresAt: instantFromDate(link.expiresAt).toString(),
			createdBy: { userId: link.createdBy, name: creatorName },
			status: linkStatus(link, input.now),
			revokedAt: link.revokedAt ? instantFromDate(link.revokedAt).toString() : null,
			revokeReason: link.revokeReason,
			revokedByName: revokerName,
			viewCount: viewed?.viewCount ?? 0,
			lastViewedAt: viewed?.lastViewedAt ? instantFromDate(viewed.lastViewedAt).toString() : null,
			canRevoke: input.reader.isOrganizationAdmin || link.createdBy === input.reader.userId,
		};
	});
}

export interface ShareLinkViewEntry {
	viewedAt: string;
	ipAddress: string | null;
	userAgent: string | null;
}

/** A link's recipient views, newest first; for its creator and owners and admins. */
export async function listShareLinkViews(
	client: DatabaseClient,
	input: { organizationId: string; linkId: string; reader: ShareLinkReader },
): Promise<ShareLinkViewEntry[] | null> {
	if (!UUID.test(input.linkId)) return null;
	const [link] = await client
		.select({ createdBy: reportShareLink.createdBy })
		.from(reportShareLink)
		.where(
			and(
				eq(reportShareLink.id, input.linkId),
				eq(reportShareLink.organizationId, input.organizationId),
			),
		)
		.limit(1);
	if (!link) return null;
	if (link.createdBy !== input.reader.userId && !input.reader.isOrganizationAdmin) return null;
	const rows = await client
		.select({
			viewedAt: reportShareLinkView.viewedAt,
			ipAddress: reportShareLinkView.ipAddress,
			userAgent: reportShareLinkView.userAgent,
		})
		.from(reportShareLinkView)
		.where(
			and(
				eq(reportShareLinkView.linkId, input.linkId),
				eq(reportShareLinkView.organizationId, input.organizationId),
			),
		)
		.orderBy(desc(reportShareLinkView.viewedAt))
		.limit(500);
	return rows.map((row) => ({
		viewedAt: instantFromDate(row.viewedAt).toString(),
		ipAddress: row.ipAddress,
		userAgent: row.userAgent,
	}));
}

// ============================================
// RECIPIENTS
// ============================================

export type OpenedShareLink =
	| {
			status: "available";
			organizationName: string;
			/** The organization's time zone, in which the page shows its dates. */
			organizationTimeZone: string;
			creatorName: string;
			createdAt: string;
			expiresAt: string;
			creatorLocale: string;
			snapshot: SharedSnapshot;
	  }
	| { status: "unavailable" };

const UNAVAILABLE: OpenedShareLink = { status: "unavailable" };

async function findByToken(client: Client, token: string): Promise<LinkRow | null> {
	if (!isWellFormedShareLinkToken(token)) return null;
	const [link] = await client
		.select()
		.from(reportShareLink)
		.where(eq(reportShareLink.tokenDigest, digestShareLinkToken(token)))
		.limit(1);
	if (!link || link.tokenHashVersion !== SHARE_LINK_TOKEN_HASH_VERSION) return null;
	return shareLinkTokenMatches(token, link.tokenDigest) ? link : null;
}

/**
 * The creator's UI language of a token's live link, for recipients whose
 * browser language Z8 lacks. Null for unknown, expired and revoked tokens
 * alike, so the page's language never tells them apart.
 */
export async function shareLinkCreatorLocale(
	client: DatabaseClient,
	token: string,
	now: Temporal.Instant,
): Promise<string | null> {
	const link = await findByToken(client, token);
	if (!link || link.revokedAt || !link.snapshot || isPastExpiry(link, now)) return null;
	return link.creatorLocale;
}

/**
 * Opens a link for a recipient. An unknown, expired or revoked token, and a
 * link whose creator lost access, are all just "unavailable". A link that
 * opens writes one row to the view log.
 */
export async function openShareLink(
	client: DatabaseClient,
	input: { token: string; now: Temporal.Instant; request: RequestContext },
): Promise<OpenedShareLink> {
	const link = await findByToken(client, input.token);
	if (!link || link.revokedAt || !link.snapshot) return UNAVAILABLE;
	if (isPastExpiry(link, input.now)) {
		await expireShareLinks(client, { now: input.now, link });
		return UNAVAILABLE;
	}
	if (!(await creatorSeesEveryProject(client, link))) {
		await withAuditTrail((audit) =>
			client.transaction((tx) =>
				markRevoked(tx, audit, link, {
					reason: "creator_lost_access",
					revokedBy: null,
					now: input.now,
				}),
			),
		);
		return UNAVAILABLE;
	}

	const [names] = await client
		.select({
			organizationName: organization.name,
			organizationTimeZone: organization.timezone,
			creatorName: user.name,
		})
		.from(organization)
		.innerJoin(user, eq(user.id, link.createdBy))
		.where(eq(organization.id, link.organizationId))
		.limit(1);
	if (!names) return UNAVAILABLE;
	await client.insert(reportShareLinkView).values({
		organizationId: link.organizationId,
		linkId: link.id,
		viewedAt: dateFromInstant(input.now),
		ipAddress: input.request.ipAddress ?? null,
		userAgent: input.request.userAgent?.slice(0, 1000) ?? null,
	});
	return {
		status: "available",
		organizationName: names.organizationName,
		organizationTimeZone: names.organizationTimeZone ?? "UTC",
		creatorName: names.creatorName,
		createdAt: instantFromDate(link.createdAt).toString(),
		expiresAt: instantFromDate(link.expiresAt).toString(),
		creatorLocale: link.creatorLocale,
		snapshot: link.snapshot,
	};
}
