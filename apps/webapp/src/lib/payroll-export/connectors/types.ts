import type { IPayrollExporter } from "../types";

/**
 * API connector contract for payroll exports.
 * Connector is currently an alias of the existing exporter contract.
 */
export type PayrollApiConnector = IPayrollExporter;

export function getPayrollApiConnectorId(connector: PayrollApiConnector): string {
	return connector.exporterId;
}
