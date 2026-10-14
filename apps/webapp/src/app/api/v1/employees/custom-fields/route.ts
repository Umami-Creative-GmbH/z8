import { publicApiRoute } from "@/lib/public-api/production";
import { listEmployeeCustomFields } from "@/lib/public-api/resources/custom-fields";

/** GET /api/v1/employees/custom-fields (Public API, key scope `employees:read`; manager- and admin-only fields need `custom-fields:read-restricted`). */
export const GET = publicApiRoute(listEmployeeCustomFields);
