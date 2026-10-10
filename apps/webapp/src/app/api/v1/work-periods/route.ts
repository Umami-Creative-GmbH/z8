import { publicApiRoute } from "@/lib/public-api/production";
import { listWorkPeriods } from "@/lib/public-api/resources/work-periods";

/** GET /api/v1/work-periods (Public API, key scope `time-entries:read`). */
export const GET = publicApiRoute(listWorkPeriods);
