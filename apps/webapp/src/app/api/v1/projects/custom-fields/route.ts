import { publicApiRoute } from "@/lib/public-api/production";
import { listProjectCustomFields } from "@/lib/public-api/resources/custom-fields";

/** GET /api/v1/projects/custom-fields (Public API, key scope `projects:read`). */
export const GET = publicApiRoute(listProjectCustomFields);
