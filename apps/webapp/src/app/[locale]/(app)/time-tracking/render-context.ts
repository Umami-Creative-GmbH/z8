import "server-only";

import { cache } from "react";
import { isAccountBanned } from "@/lib/auth/account-ban";
import { getRenderSession } from "@/lib/auth/render-session";
import { canAccessOrganization } from "@/lib/organization-mfa/organization-access";
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
			isAccountBanned(session.user) ||
			("ssoRequired" in session && session.ssoRequired === true) ||
			("mfaRequired" in session && !!session.mfaRequired)
		) {
			return null;
		}

		const activeOrganizationId = session.session?.activeOrganizationId;
		if (
			activeOrganizationId &&
			!(await canAccessOrganization(session.session, activeOrganizationId))
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
