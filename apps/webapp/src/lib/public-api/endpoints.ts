import type { PublicApiEndpoint } from "./endpoint";
import { listAbsences } from "./resources/absences";
import { listCustomers } from "./resources/customers";
import { listEmployees } from "./resources/employees";
import { listProjects } from "./resources/projects";
import { listWorkPeriods } from "./resources/work-periods";

/** Every Public API v1 endpoint, in the order the OpenAPI document lists them. */
export const PUBLIC_API_ENDPOINTS: readonly PublicApiEndpoint[] = [
	listWorkPeriods,
	listAbsences,
	listEmployees,
	listProjects,
	listCustomers,
];
