import { publicApiRoute } from "@/lib/public-api/production";
import { listCustomerCustomFields } from "@/lib/public-api/resources/custom-fields";

/** GET /api/v1/customers/custom-fields (Public API, key scope `customers:read`; manager- and admin-only fields need `custom-fields:read-restricted`). */
export const GET = publicApiRoute(listCustomerCustomFields);
