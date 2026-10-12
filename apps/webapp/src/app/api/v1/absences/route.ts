import { publicApiRoute } from "@/lib/public-api/production";
import { listAbsences } from "@/lib/public-api/resources/absences";

/** GET /api/v1/absences (Public API, key scope `absences:read`; health detail needs `absences:read-health`). */
export const GET = publicApiRoute(listAbsences);
