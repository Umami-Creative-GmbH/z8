import "server-only";

import { cache } from "react";
import { getRenderSession } from "@/lib/auth/render-session";
import { canAccessOrganizationWithSso } from "@/lib/enterprise-identity/session-sso-store";
import { getRenderUserPreferences } from "@/lib/user-preferences/render-snapshot";
import type { TimeFormat } from "@/lib/user-preferences/time-format";
import type { WeekStartDay } from "@/lib/user-preferences/week-start";
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
			getRenderUserPreferences(session.user.id),
		]);

		return {
			userId: session.user.id,
			employeeName: session.user.name || "",
			timezone: settings.timezone,
			timeFormat: settings.timeFormat,
			weekStartDay: settings.weekStartDay,
			...(employeeContext ?? { employee: null, membershipRole: null }),
		};
	},
);
