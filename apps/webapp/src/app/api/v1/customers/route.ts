import { publicApiRoute } from "@/lib/public-api/production";
import { listCustomers } from "@/lib/public-api/resources/customers";

/** GET /api/v1/customers (Public API, key scope `customers:read`). */
export const GET = publicApiRoute(listCustomers);
