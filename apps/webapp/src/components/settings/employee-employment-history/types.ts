import type {
	FormAsyncValidateOrFn,
	FormValidateOrFn,
	ReactFormExtendedApi,
} from "@tanstack/react-form";
import type { UpsertEmploymentHistory } from "@/lib/validations/employment-history";

export type ContractType = UpsertEmploymentHistory["contractType"];
export type ReviewState = UpsertEmploymentHistory["reviewState"];
export type WorkModel = UpsertEmploymentHistory["workModel"];

export type EmploymentHistoryWorkPolicyOption = {
	id: string;
	name: string;
};

export type EmploymentHistoryEntry = {
	id: string;
	validFrom: Date | string;
	validUntil: Date | string | null;
	status: string;
	contractType: ContractType;
	weeklyContractMinutes: number;
	probationStartsOn: Date | string | null;
	probationEndsOn: Date | string | null;
	workModel: WorkModel;
	workPolicyId: string | null;
	workPolicy?: EmploymentHistoryWorkPolicyOption | null;
	hourlyRate: string | null;
	currency: string;
	changeReason: string | null;
	reviewState: ReviewState;
	confirmedAt?: Date | string | null;
};

export type MutationResult<T = unknown> = { success: boolean; data?: T; error?: string };

export type EmployeeEmploymentHistoryCardProps = {
	history: EmploymentHistoryEntry[];
	canManage: boolean;
	onCreate: (data: UpsertEmploymentHistory) => Promise<MutationResult>;
	onConfirm: (historyId: string) => Promise<MutationResult>;
	onCancel: (historyId: string) => Promise<MutationResult>;
	isCreating: boolean;
	isMutating: boolean;
	workPolicies?: EmploymentHistoryWorkPolicyOption[];
};

export type FormValues = {
	validFrom: string;
	reviewState: ReviewState;
	weeklyHours: string;
	workModel: WorkModel;
	contractType: ContractType;
	workPolicyId: string;
	hourlyRate: string;
	probationStartsOn: string;
	probationEndsOn: string;
	changeReason: string;
};

export type EmploymentHistoryFormApi = ReactFormExtendedApi<
	FormValues,
	FormValidateOrFn<FormValues> | undefined,
	FormValidateOrFn<FormValues> | undefined,
	FormAsyncValidateOrFn<FormValues> | undefined,
	FormValidateOrFn<FormValues> | undefined,
	FormAsyncValidateOrFn<FormValues> | undefined,
	FormValidateOrFn<FormValues> | undefined,
	FormAsyncValidateOrFn<FormValues> | undefined,
	FormValidateOrFn<FormValues> | undefined,
	FormAsyncValidateOrFn<FormValues> | undefined,
	FormAsyncValidateOrFn<FormValues> | undefined,
	unknown
>;
