import { publicApiRoute } from "@/lib/public-api/production";
import { listCustomerCustomFields } from "@/lib/public-api/resources/custom-fields";

/** GET /api/v1/customers/custom-fields (Public API, key scope `customers:read`). */
export const GET = publicApiRoute(listCustomerCustomFields);
