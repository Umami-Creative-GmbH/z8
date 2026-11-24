"use server";

import { z } from "zod";
import { systemClock } from "@/lib/datetime/temporal-core";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { storeStep } from "@/lib/organization-action/store-step";
import {
	loadStatutoryAcknowledgementHistory,
	statutoryAcknowledgementReviewStatuses,
} from "@/lib/statutory/acknowledgement-history";
import { statutoryAcknowledgementKinds } from "@/lib/statutory/acknowledgement-kinds";
import { loadStatutoryMonitorFindings } from "@/lib/statutory/review-inbox";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";

// The unified statutory Reviews & Conflicts inbox (#1994), org admins only: the monitor findings
// no domain review list carries, and the audited acknowledgement history of one subject.

export const listStatutoryMonitorFindingsAction = organizationAction(
	{ name: "contracts.statutoryReviews.listMonitorFindings", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		storeStep("contracts.statutoryReviews.listMonitorFindings", async (db) =>
			loadStatutoryMonitorFindings(db, {
				organizationId,
				timezone: await loadOrganizationTimezone(db, organizationId),
				now: systemClock.nowInstant(),
			}),
		),
);

export const listStatutoryAcknowledgementHistoryAction = organizationAction(
	{
		name: "contracts.statutoryReviews.acknowledgementHistory",
		requires: "orgAdmin",
		schema: z.strictObject({
			employeeId: z.uuid(),
			acknowledgementKind: z.enum(statutoryAcknowledgementKinds),
			findingKind: z.string().trim().min(1).max(100),
			subjectKey: z.string().trim().min(1).max(200),
			/**
			 * The finding as the admin sees it: which row documents it. Display only; it never decides
			 * what is recorded.
			 */
			currentInputFingerprint: z.string().max(200),
			currentStatus: z.enum(statutoryAcknowledgementReviewStatuses),
		}),
	},
	({ organizationId, input }) =>
		storeStep("contracts.statutoryReviews.acknowledgementHistory", async (db) => ({
			// Acknowledgement times are shown in the organization's zone, never the viewer's.
			timezone: await loadOrganizationTimezone(db, organizationId),
			entries: await loadStatutoryAcknowledgementHistory(db, {
				organizationId,
				subject: {
					employeeId: input.employeeId,
					kind: input.acknowledgementKind,
					findingKind: input.findingKind,
					subjectKey: input.subjectKey,
				},
				currentInputFingerprint: input.currentInputFingerprint,
				currentStatus: input.currentStatus,
			}),
		})),
);
