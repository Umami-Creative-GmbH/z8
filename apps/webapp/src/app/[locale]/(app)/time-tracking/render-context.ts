import "server-only";

import { eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import { userSettings } from "@/db/schema";
import { getRenderSession } from "@/lib/auth/render-session";
import { canAccessOrganizationWithSso } from "@/lib/enterprise-identity/session-sso-store";
import {
	normalizeTimeFormat,
	type TimeFormat,
} from "@/lib/user-preferences/time-format";
import {
	normalizeWeekStartDay,
	type WeekStartDay,
} from "@/lib/user-preferences/week-start";
import type { CurrentEmployee } from "./actions/auth";
import {
	type ApprovedEmployeeContext,
	resolveEmployeeContext,
} from "./actions/employee-context";

export type TimeTrackingRenderContext = {
	userId: string;
	employeeName: string;
	timezone: string;
	timeFormat: TimeFormat;
	weekStartDay: WeekStartDay;
} & (ApprovedEmployeeContext | { employee: null; membershipRole: null });

export type EmployeeRenderContext = Extract<
	TimeTrackingRenderContext,
	{ employee: CurrentEmployee }
>;

export const getTimeTrackingRenderContext = cache(
	async (): Promise<TimeTrackingRenderContext | null> => {
		const session = await getRenderSession();
		if (
			!session?.user ||
			session.user.banned === true ||
			("ssoRequired" in session && session.ssoRequired === true)
		) {
			return null;
		}

		const activeOrganizationId = session.session?.activeOrganizationId;
		if (
			activeOrganizationId &&
			!(await canAccessOrganizationWithSso(
				session.session,
				activeOrganizationId,
			))
		) {
			return null;
		}

		const [employeeContext, settings] = await Promise.all([
			resolveEmployeeContext(session),
			db.query.userSettings.findFirst({
				where: eq(userSettings.userId, session.user.id),
				columns: { timezone: true, weekStartDay: true, timeFormat: true },
			}),
		]);

		return {
			userId: session.user.id,
			employeeName: session.user.name || "",
			timezone: settings?.timezone || "UTC",
			timeFormat: normalizeTimeFormat(settings?.timeFormat),
			weekStartDay: normalizeWeekStartDay(settings?.weekStartDay),
			...(employeeContext ?? { employee: null, membershipRole: null }),
		};
	},
);
