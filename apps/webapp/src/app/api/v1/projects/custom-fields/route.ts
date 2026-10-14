import { publicApiRoute } from "@/lib/public-api/production";
import { listProjectCustomFields } from "@/lib/public-api/resources/custom-fields";

/** GET /api/v1/projects/custom-fields (Public API, key scope `projects:read`; manager- and admin-only fields need `custom-fields:read-restricted`). */
export const GET = publicApiRoute(listProjectCustomFields);
