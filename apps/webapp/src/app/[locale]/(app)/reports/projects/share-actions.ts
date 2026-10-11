"use server";

import { Effect } from "effect";
import { headers } from "next/headers";
import { requireAuth } from "@/lib/auth-helpers";
import { systemClock } from "@/lib/datetime/temporal-core";
import {
	type AnyAppError,
	AuthorizationError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import {
	type AppServices,
	runServerActionSafe,
	type ServerActionResult,
} from "@/lib/effect/result";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	type CreatedShareLink,
	createShareLink,
	listShareLinks,
	listShareLinkViews,
	type RequestContext,
	revokeShareLink,
	type ShareLinkSummary,
	type ShareLinkViewEntry,
	type ShareTarget,
} from "@/lib/projects/report-share/report-share-links";
import type { ShareLinkFigures } from "@/lib/projects/report-share/shared-snapshot";
import { getClientIp } from "@/lib/rate-limit";
import { loadProjectReportViewer } from "@/lib/reports/project-billable-report";
import { canViewProjectReports } from "@/lib/reports/project-report-access";

type ShareEffect<T> = Effect.Effect<T, AnyAppError, AppServices>;

export type CreateReportShareLinkInput = ShareTarget & {
	fromDay: string;
	toDay: string;
	figures: ShareLinkFigures;
	/** Project links only. */
	includeEmployees?: boolean;
	/** Omitted: 30 days. */
	expiresInDays?: number | null;
	/** The creator's UI language, the recipient page's fallback. */
	locale: string;
};

/** The signed-in member of the active organization, with their project report access. */
function shareLinkActor() {
	return Effect.gen(function* () {
		const authContext = yield* Effect.tryPromise({
			try: async () => await requireAuth(),
			catch: () =>
				new AuthorizationError({ message: "Approved organization membership required" }),
		});
		const organizationId = authContext.session.activeOrganizationId;
		const currentEmployee = authContext.employee;
		if (!organizationId || !currentEmployee) {
			return yield* Effect.fail(new AuthorizationError({ message: "Active organization required" }));
		}
		const dbService = yield* DatabaseService;
		const viewer = yield* dbService.query("reportShareLink.getViewer", () =>
			loadProjectReportViewer(dbService.db, {
				organizationId,
				userId: authContext.user.id,
				employee: currentEmployee,
			}),
		);
		return { dbService, organizationId, userId: authContext.user.id, currentEmployee, viewer };
	});
}

function requestContext() {
	return Effect.promise(async (): Promise<RequestContext> => {
		const requestHeaders = await headers();
		const ipAddress = getClientIp(new Request("http://localhost", { headers: requestHeaders }));
		return {
			ipAddress: ipAddress === "unknown" ? null : ipAddress,
			userAgent: requestHeaders.get("user-agent"),
		};
	});
}

function shareTarget(input: unknown): ShareTarget | null {
	if (!input || typeof input !== "object") return null;
	const target = input as Partial<{ kind: string; projectId: unknown; customerId: unknown }>;
	if (target.kind === "project" && typeof target.projectId === "string") {
		return { kind: "project", projectId: target.projectId };
	}
	if (target.kind === "customer" && typeof target.customerId === "string") {
		return { kind: "customer", customerId: target.customerId };
	}
	return null;
}

/**
 * Shares a project's report, or one customer's billable report, as a frozen
 * snapshot behind a new report share link. The returned path is shown once.
 */
export async function createReportShareLink(
	input: CreateReportShareLinkInput,
): Promise<ServerActionResult<CreatedShareLink>> {
	const effect: ShareEffect<CreatedShareLink> = Effect.gen(function* () {
		const target = shareTarget(input);
		if (!target) {
			return yield* Effect.fail(new ValidationError({ message: "Choose a report to share" }));
		}
		const { organizationId, userId, currentEmployee, viewer } = yield* shareLinkActor();
		if (!canViewProjectReports(viewer)) {
			return yield* Effect.fail(
				new AuthorizationError({ message: "You don't have permission to share this report" }),
			);
		}
		const request = yield* requestContext();
		return yield* createShareLink({
			organizationId,
			creator: { userId, employeeId: currentEmployee.id },
			viewer,
			target,
			fromDay: String(input.fromDay),
			toDay: String(input.toDay),
			figures: input.figures,
			includeEmployees: input.includeEmployees === true,
			...(input.expiresInDays === undefined ? {} : { expiresInDays: input.expiresInDays }),
			creatorLocale: String(input.locale),
			now: systemClock.nowInstant(),
			request,
		});
	});
	return runServerActionSafe(effect);
}

/**
 * The share links of one report, or of the whole organization without a
 * target: every link for owners and admins, the reader's own otherwise.
 */
export async function listReportShareLinks(
	target?: ShareTarget,
): Promise<ServerActionResult<ShareLinkSummary[]>> {
	const effect: ShareEffect<ShareLinkSummary[]> = Effect.gen(function* () {
		const scopedTarget = target === undefined ? undefined : shareTarget(target);
		if (target !== undefined && !scopedTarget) {
			return yield* Effect.fail(new ValidationError({ message: "Choose a report" }));
		}
		const { dbService, organizationId, userId, viewer } = yield* shareLinkActor();
		return yield* dbService.query("reportShareLink.list", () =>
			listShareLinks(dbService.db, {
				organizationId,
				reader: { userId, isOrganizationAdmin: viewer.isOrganizationAdmin },
				...(scopedTarget ? { target: scopedTarget } : {}),
				now: systemClock.nowInstant(),
			}),
		);
	});
	return runServerActionSafe(effect);
}

/** A link's recipient views, for its creator and owners and admins. */
export async function listReportShareLinkViews(
	linkId: string,
): Promise<ServerActionResult<ShareLinkViewEntry[]>> {
	const effect: ShareEffect<ShareLinkViewEntry[]> = Effect.gen(function* () {
		const { dbService, organizationId, userId, viewer } = yield* shareLinkActor();
		const views = yield* dbService.query("reportShareLink.listViews", () =>
			listShareLinkViews(dbService.db, {
				organizationId,
				linkId: String(linkId),
				reader: { userId, isOrganizationAdmin: viewer.isOrganizationAdmin },
			}),
		);
		if (!views) {
			return yield* Effect.fail(
				new NotFoundError({ message: "Share link not found", entityType: "report_share_link" }),
			);
		}
		return views;
	});
	return runServerActionSafe(effect);
}

/** Revokes a link at once; its creator or an owner or admin may. */
export async function revokeReportShareLink(linkId: string): Promise<ServerActionResult<void>> {
	const effect: ShareEffect<void> = Effect.gen(function* () {
		const { dbService, organizationId, userId, viewer } = yield* shareLinkActor();
		const request = yield* requestContext();
		const result = yield* dbService.query("reportShareLink.revoke", () =>
			revokeShareLink(dbService.db, {
				organizationId,
				linkId: String(linkId),
				actor: { userId, isOrganizationAdmin: viewer.isOrganizationAdmin },
				now: systemClock.nowInstant(),
				request,
			}),
		);
		if (!result.ok) {
			return yield* Effect.fail(
				result.reason === "forbidden"
					? new AuthorizationError({ message: "You don't have permission to revoke this link" })
					: new NotFoundError({ message: "Share link not found", entityType: "report_share_link" }),
			);
		}
	});
	return runServerActionSafe(effect);
}
