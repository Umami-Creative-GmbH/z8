"use server";

import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { user } from "@/db/auth-schema";
import { employee, positionCaptureAssignment, team } from "@/db/schema";
import { canManageCurrentOrganizationSettings, getAuthContext } from "@/lib/auth-helpers";
import { instantToCanonicalString } from "@/lib/datetime/temporal-core";
import { runPositionCaptureAction } from "@/lib/time-tracking/position-capture/action-runner";
import {
	type PositionCaptureActionResult,
	PositionCaptureRefusal,
	requireUuid,
} from "@/lib/time-tracking/position-capture/errors";
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
	employees: PositionCaptureOption[];
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

export async function getPositionCaptureAdminDataAction(): Promise<
	PositionCaptureActionResult<PositionCaptureAdminData>
> {
	return runPositionCaptureAction("positionCapture.adminData", async (db) => {
		const { organizationId } = await requirePositionCaptureAdmin();
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
			db
				.select({
					id: employee.id,
					employeeNumber: employee.employeeNumber,
					userName: user.name,
				})
				.from(employee)
				.innerJoin(user, eq(employee.userId, user.id))
				.where(and(eq(employee.organizationId, organizationId), eq(employee.isActive, true)))
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
			})),
		};
	});
}

export async function savePositionCaptureSettingsAction(
	input: SavePositionCaptureSettingsInput,
): Promise<PositionCaptureActionResult<{ publishedNoticeVersion: number | null }>> {
	return runPositionCaptureAction("positionCapture.saveSettings", async (db) => {
		const { organizationId, userId } = await requirePositionCaptureAdmin();
		const { publishedNotice } = await db.transaction((tx) =>
			savePositionCaptureSettings(tx, {
				organizationId,
				actorUserId: userId,
				settings: {
					enabled: input?.enabled === true,
					purposeStatement:
						typeof input?.purposeStatement === "string" ? input.purposeStatement : null,
					retentionDays: Number(input?.retentionDays),
				},
			}),
		);
		revalidatePath(SETTINGS_PATH);
		revalidatePath("/settings/position-stamps");
		return { publishedNoticeVersion: publishedNotice?.version ?? null };
	});
}

export async function setPositionCaptureAssignmentAction(
	input: SetPositionCaptureAssignmentInput,
): Promise<PositionCaptureActionResult<{ assignmentId: string }>> {
	return runPositionCaptureAction("positionCapture.setAssignment", async (db) => {
		const { organizationId, userId } = await requirePositionCaptureAdmin();
		const target = parseTarget(input?.target);
		const result = await db.transaction((tx) =>
			setPositionCaptureAssignment(tx, {
				organizationId,
				actorUserId: userId,
				target,
				captureEnabled: input?.captureEnabled === true,
			}),
		);
		revalidatePath(SETTINGS_PATH);
		return result;
	});
}

export async function removePositionCaptureAssignmentAction(input: {
	assignmentId: string;
}): Promise<PositionCaptureActionResult<{ assignmentId: string }>> {
	return runPositionCaptureAction("positionCapture.removeAssignment", async (db) => {
		const { organizationId, userId } = await requirePositionCaptureAdmin();
		const assignmentId = parseUuid(input?.assignmentId, "assignmentId");
		await db.transaction((tx) =>
			removePositionCaptureAssignment(tx, { organizationId, actorUserId: userId, assignmentId }),
		);
		revalidatePath(SETTINGS_PATH);
		return { assignmentId };
	});
}

/** Organization owners and admins of the active organization only. */
async function requirePositionCaptureAdmin(): Promise<{ organizationId: string; userId: string }> {
	const authContext = await getAuthContext();
	const organizationId = authContext?.session.activeOrganizationId ?? null;
	if (!authContext || !organizationId || !(await canManageCurrentOrganizationSettings())) {
		throw new PositionCaptureRefusal(
			"admin_only",
			"Only organization owners and admins can manage position capture.",
		);
	}
	return { organizationId, userId: authContext.user.id };
}

function parseTarget(value: unknown): PositionCaptureAssignmentTarget {
	const target = value as Partial<{ type: string; teamId: unknown; employeeId: unknown }> | null;
	if (target?.type === "organization") return { type: "organization" };
	if (target?.type === "team") return { type: "team", teamId: parseUuid(target.teamId, "teamId") };
	if (target?.type === "employee") {
		return { type: "employee", employeeId: parseUuid(target.employeeId, "employeeId") };
	}
	throw new PositionCaptureRefusal("invalid_target", "Choose who the assignment applies to.");
}

function parseUuid(value: unknown, field: string): string {
	return requireUuid(value, { code: "invalid_selection", message: `Invalid selection: ${field}.` });
}
