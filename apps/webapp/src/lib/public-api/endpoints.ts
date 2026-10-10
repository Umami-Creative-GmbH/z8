import type { PublicApiEndpoint } from "./endpoint";
import { listEmployees } from "./resources/employees";

/** Every Public API v1 endpoint, in the order the OpenAPI document lists them. */
export const PUBLIC_API_ENDPOINTS: readonly PublicApiEndpoint[] = [listEmployees];
