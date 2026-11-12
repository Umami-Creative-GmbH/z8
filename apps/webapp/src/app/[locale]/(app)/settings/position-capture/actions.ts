"use server";

import { and, asc, eq, inArray, isNotNull, or } from "drizzle-orm";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { user } from "@/db/auth-schema";
import { employee, positionCaptureAssignment, team } from "@/db/schema";
import { instantToCanonicalString } from "@/lib/datetime/temporal-core";
import { queryOrRefuse } from "@/lib/effect/refusal-query";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import {
	formerSinceDate,
	isFormerEmployee,
	onCurrentRoster,
} from "@/lib/employee-lifecycle/current-roster";
import { formerSinceField } from "@/lib/employee-lifecycle/former-since";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import {
	assignmentIdSchema,
	assignmentTargetSchema,
} from "@/lib/time-tracking/assignment-target-schema";
import { PositionCaptureRefusal } from "@/lib/time-tracking/position-capture/errors";
import type { PositionCaptureSettings } from "@/lib/time-tracking/position-capture/policy";
import {
	listPositionNotices,
	type PositionCaptureAssignmentTarget,
	readPositionCaptureSettings,
	removePositionCaptureAssignment,
	savePositionCaptureSettings,
	setPositionCaptureAssignment,
} from "@/lib/time-tracking/position-capture/store";

export type PositionNoticeVersionData = {
	id: string;
	version: number;
	purposeStatement: string;
	retentionDays: number;
	templateRevision: number;
	/** ISO instant. */
	createdAt: string;
};

export type PositionCaptureAssignmentData = {
	id: string;
	assignmentType: "organization" | "team" | "employee";
	teamId: string | null;
	employeeId: string | null;
	captureEnabled: boolean;
};

export type PositionCaptureOption = { id: string; name: string };

export type PositionCaptureAdminData = {
	settings: PositionCaptureSettings;
	notices: PositionNoticeVersionData[];
	assignments: PositionCaptureAssignmentData[];
	teams: PositionCaptureOption[];
	/**
	 * The current roster, and former employees an assignment names (`isFormer`,
	 * with `formerSince`: the date they left, null when not recorded, #1439).
	 */
	employees: Array<PositionCaptureOption & { isFormer: boolean; formerSince?: string | null }>;
};

export type SavePositionCaptureSettingsInput = {
	enabled: boolean;
	purposeStatement: string | null;
	retentionDays: number;
};

export type SetPositionCaptureAssignmentInput = {
	target: PositionCaptureAssignmentTarget;
	captureEnabled: boolean;
};

const SETTINGS_PATH = "/settings/position-capture";

/** The store checks the purpose and the retention range and refuses with its own codes. */
const saveSettingsSchema = z.strictObject({
	enabled: z.boolean(),
	purposeStatement: z.string().nullable(),
	retentionDays: z.number(),
}) satisfies z.ZodType<SavePositionCaptureSettingsInput>;

const setAssignmentSchema = z.strictObject({
	target: assignmentTargetSchema,
	captureEnabled: z.boolean(),
}) satisfies z.ZodType<SetPositionCaptureAssignmentInput>;

const removeAssignmentSchema = z.strictObject({ assignmentId: assignmentIdSchema });

/** Store work for position capture; a `PositionCaptureRefusal` comes back as the result's `refusal`. */
function positionCaptureWork<T>(name: string, work: (db: DatabaseClient) => Promise<T>) {
	return queryOrRefuse(name, PositionCaptureRefusal, work);
}

const revalidateSettings = Effect.sync(() => revalidatePath(SETTINGS_PATH));

export const getPositionCaptureAdminDataAction = organizationAction(
	{ name: "positionCapture.adminData", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		positionCaptureWork("positionCapture.adminData", (db) =>
			loadPositionCaptureAdminData(db, organizationId),
		),
);

/** The settings page's data; only the session organization's rows. */
async function loadPositionCaptureAdminData(
	db: DatabaseClient,
	organizationId: string,
): Promise<PositionCaptureAdminData> {
	const [settings, notices, assignments, teams, employees] = await Promise.all([
		readPositionCaptureSettings(db, organizationId),
		listPositionNotices(db, organizationId),
		db
			.select({
				id: positionCaptureAssignment.id,
				assignmentType: positionCaptureAssignment.assignmentType,
				teamId: positionCaptureAssignment.teamId,
				employeeId: positionCaptureAssignment.employeeId,
				captureEnabled: positionCaptureAssignment.captureEnabled,
			})
			.from(positionCaptureAssignment)
			.where(eq(positionCaptureAssignment.organizationId, organizationId))
			.orderBy(asc(positionCaptureAssignment.priority), asc(positionCaptureAssignment.createdAt)),
		db
			.select({ id: team.id, name: team.name })
			.from(team)
			.where(eq(team.organizationId, organizationId))
			.orderBy(asc(team.name)),
		// The current roster (#1438), plus former employees an assignment still
		// names, marked, so their row keeps its name.
		db
			.select({
				id: employee.id,
				employeeNumber: employee.employeeNumber,
				userName: user.name,
				isFormer: isFormerEmployee(employee),
				formerSince: formerSinceDate(employee),
			})
			.from(employee)
			.innerJoin(user, eq(employee.userId, user.id))
			.where(
				and(
					eq(employee.organizationId, organizationId),
					or(
						onCurrentRoster(organizationId),
						inArray(
							employee.id,
							db
								.select({ id: positionCaptureAssignment.employeeId })
								.from(positionCaptureAssignment)
								.where(
									and(
										eq(positionCaptureAssignment.organizationId, organizationId),
										isNotNull(positionCaptureAssignment.employeeId),
									),
								),
						),
					),
				),
			)
			.orderBy(asc(user.name), asc(employee.id)),
	]);
	return {
		settings,
		notices: notices.map((notice) => ({
			...notice,
			createdAt: instantToCanonicalString(notice.createdAt),
		})),
		assignments,
		teams,
		employees: employees.map((row) => ({
			id: row.id,
			name: row.userName?.trim() || row.employeeNumber || row.id,
			isFormer: row.isFormer,
			...formerSinceField(row.isFormer, row.formerSince),
		})),
	};
}

export const savePositionCaptureSettingsAction = organizationAction(
	{ name: "positionCapture.saveSettings", requires: "orgAdmin", schema: saveSettingsSchema },
	({ actor, organizationId, input }) =>
		positionCaptureWork("positionCapture.saveSettings", async (db) => {
			const { publishedNotice } = await db.transaction((tx) =>
				savePositionCaptureSettings(tx, {
					organizationId,
					actorUserId: actor.userId,
					settings: input,
				}),
			);
			return { publishedNoticeVersion: publishedNotice?.version ?? null };
		}).pipe(
			Effect.tap(() =>
				Effect.sync(() => {
					revalidatePath(SETTINGS_PATH);
					revalidatePath("/settings/position-stamps");
				}),
			),
		),
);

export const setPositionCaptureAssignmentAction = organizationAction(
	{
		name: "positionCapture.setAssignment",
		requires: "orgAdmin",
		schema: setAssignmentSchema,
		// No `addsEmployees`: switching a former employee's existing assignment must
		// still work, so the store refuses only a new one (`former_employee`, #1438).
	},
	({ actor, organizationId, input }) =>
		positionCaptureWork("positionCapture.setAssignment", (db) =>
			db.transaction((tx) =>
				setPositionCaptureAssignment(tx, {
					organizationId,
					actorUserId: actor.userId,
					target: input.target,
					captureEnabled: input.captureEnabled,
				}),
			),
		).pipe(Effect.tap(() => revalidateSettings)),
);

export const removePositionCaptureAssignmentAction = organizationAction(
	{
		name: "positionCapture.removeAssignment",
		requires: "orgAdmin",
		schema: removeAssignmentSchema,
	},
	({ actor, organizationId, input }) =>
		positionCaptureWork("positionCapture.removeAssignment", async (db) => {
			await db.transaction((tx) =>
				removePositionCaptureAssignment(tx, {
					organizationId,
					actorUserId: actor.userId,
					assignmentId: input.assignmentId,
				}),
			);
			return { assignmentId: input.assignmentId };
		}).pipe(Effect.tap(() => revalidateSettings)),
);
