import "server-only";

import { cache } from "react";
import { getCurrentSettingsAccess } from "@/lib/auth-helpers";
import { getStatisticsScope } from "../settings/statistics/actions";

/** Request-scoped memoized readers shared by `/analytics` layout and Overview health sections. */
export const loadAnalyticsSettingsAccess = cache(() => getCurrentSettingsAccess());

export const loadAnalyticsStatisticsScope = cache(() => getStatisticsScope());
