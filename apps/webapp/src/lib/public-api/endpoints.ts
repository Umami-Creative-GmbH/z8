import type { PublicApiEndpoint } from "./endpoint";
import { listCustomers } from "./resources/customers";
import { listEmployees } from "./resources/employees";
import { listProjects } from "./resources/projects";

/** Every Public API v1 endpoint, in the order the OpenAPI document lists them. */
export const PUBLIC_API_ENDPOINTS: readonly PublicApiEndpoint[] = [
	listEmployees,
	listProjects,
	listCustomers,
];
