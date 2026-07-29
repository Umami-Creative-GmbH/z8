"use client";

import {
	type ApiKeyCreateDialogProps,
	ApiKeyCreateFormBody,
} from "./api-key-create-form-body";

export function ApiKeyCreateDialog(props: ApiKeyCreateDialogProps) {
	return <ApiKeyCreateFormBody {...props} />;
}
