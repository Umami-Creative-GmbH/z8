import { getPayrollApiConnectorId, type PayrollApiConnector } from "./types";

export class PayrollConnectorRegistry {
	private readonly connectors = new Map<string, PayrollApiConnector>();

	register(connector: PayrollApiConnector): void {
		this.connectors.set(getPayrollApiConnectorId(connector), connector);
	}

	get(connectorId: string): PayrollApiConnector | undefined {
		return this.connectors.get(connectorId);
	}

	list(): PayrollApiConnector[] {
		return Array.from(this.connectors.values());
	}

	has(connectorId: string): boolean {
		return this.connectors.has(connectorId);
	}
}
