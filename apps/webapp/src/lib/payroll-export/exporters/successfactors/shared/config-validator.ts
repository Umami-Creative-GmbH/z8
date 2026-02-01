/**
 * Configuration validation for SAP SuccessFactors
 */
import type { SuccessFactorsConfig } from "../types";

/**
 * Validation result
 */
export interface ValidationResult {
	valid: boolean;
	errors?: string[];
}

/**
 * Validate SAP SuccessFactors configuration
 */
export function validateSuccessFactorsConfig(
	config: Record<string, unknown>,
): ValidationResult {
	const errors: string[] = [];
	const sfConfig = config as Partial<SuccessFactorsConfig>;

	// Validate employee match strategy
	if (
		sfConfig.employeeMatchStrategy &&
		!["userId", "personIdExternal", "email"].includes(sfConfig.employeeMatchStrategy)
	) {
		errors.push("Employee match strategy must be 'userId', 'personIdExternal', or 'email'");
	}

	// Validate instance URL format
	if (sfConfig.instanceUrl) {
		try {
			const url = new URL(sfConfig.instanceUrl);
			if (url.protocol !== "https:") {
				errors.push("Instance URL must use HTTPS");
			}
			if (!url.hostname.includes("successfactors")) {
				errors.push("Instance URL should be a SAP SuccessFactors domain");
			}
		} catch {
			errors.push("Instance URL is not a valid URL");
		}
	}

	// Validate company ID (required for API mode)
	if (sfConfig.companyId !== undefined && typeof sfConfig.companyId !== "string") {
		errors.push("Company ID must be a string");
	}

	// Validate batch size
	if (
		sfConfig.batchSize !== undefined &&
		(sfConfig.batchSize < 1 || sfConfig.batchSize > 100)
	) {
		errors.push("Batch size must be between 1 and 100");
	}

	// Validate API timeout
	if (
		sfConfig.apiTimeoutMs !== undefined &&
		(sfConfig.apiTimeoutMs < 5000 || sfConfig.apiTimeoutMs > 300000)
	) {
		errors.push("API timeout must be between 5000 and 300000 milliseconds");
	}

	return {
		valid: errors.length === 0,
		errors: errors.length > 0 ? errors : undefined,
	};
}

/**
 * Validate configuration has required fields for API export
 */
export function validateApiConfig(config: SuccessFactorsConfig): ValidationResult {
	const errors: string[] = [];

	if (!config.instanceUrl) {
		errors.push("Instance URL is required for API export");
	}

	if (!config.companyId) {
		errors.push("Company ID is required for API export");
	}

	return {
		valid: errors.length === 0,
		errors: errors.length > 0 ? errors : undefined,
	};
}
