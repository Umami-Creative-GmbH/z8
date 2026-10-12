import { publicApiRoute } from "@/lib/public-api/production";
import { listEmployees } from "@/lib/public-api/resources/employees";

/** GET /api/v1/employees (Public API, key scope `employees:read`). */
export const GET = publicApiRoute(listEmployees);
