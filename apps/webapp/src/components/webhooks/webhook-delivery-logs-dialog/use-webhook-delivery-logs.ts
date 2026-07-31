"use client";

import { useEffect, useRef, useState } from "react";
import { getWebhookDeliveryLogs } from "@/app/[locale]/(app)/settings/webhooks/actions";
import type { WebhookDelivery } from "@/lib/webhooks/types";

export const WEBHOOK_DELIVERY_LOGS_PAGE_SIZE = 20;

type Page = { webhookId: string; offset: number };
type DeliveryPage = { requestKey: string; deliveries: WebhookDelivery[]; total: number };
type RequestError = { requestKey: string; message: string };

export function useWebhookDeliveryLogs(webhookId: string, open: boolean) {
	const [isLoading, setIsLoading] = useState(false);
	const [page, setPage] = useState<Page>({ webhookId, offset: 0 });
	const [deliveryPage, setDeliveryPage] = useState<DeliveryPage>({
		requestKey: "",
		deliveries: [],
		total: 0,
	});
	const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
	const [loadedRequestKey, setLoadedRequestKey] = useState<string | null>(null);
	const [requestError, setRequestError] = useState<RequestError | null>(null);
	const [retryToken, setRetryToken] = useState(0);
	const requestSequence = useRef(0);
	const latestLoadKey = useRef("");

	if (page.webhookId !== webhookId) {
		setPage({ webhookId, offset: 0 });
		setExpandedRows(new Set());
	}

	const offset = page.webhookId === webhookId ? page.offset : 0;
	const requestKey = `${webhookId}:${offset}`;
	const loadKey = `${requestKey}:${retryToken}`;
	const deliveries = deliveryPage.requestKey === requestKey ? deliveryPage.deliveries : [];
	const total = deliveryPage.requestKey === requestKey ? deliveryPage.total : 0;

	useEffect(() => {
		if (!open) {
			return;
		}

		const requestId = ++requestSequence.current;
		latestLoadKey.current = loadKey;
		let cancelled = false;

		void Promise.resolve()
			.then(() => {
				if (cancelled) {
					return null;
				}

				setRequestError(null);
				setIsLoading(true);
				return getWebhookDeliveryLogs(webhookId, {
					limit: WEBHOOK_DELIVERY_LOGS_PAGE_SIZE,
					offset,
				}).catch(() => null);
			})
			.then((result) => {
				if (
					cancelled ||
					requestId !== requestSequence.current ||
					loadKey !== latestLoadKey.current
				) {
					return;
				}
				if (result?.success && result.data) {
					setDeliveryPage({
						requestKey,
						deliveries: result.data.deliveries,
						total: result.data.total,
					});
				} else {
					setRequestError({
						requestKey,
						message: result && !result.success ? result.error : "",
					});
				}
				setLoadedRequestKey(requestKey);
				setIsLoading(false);
			});

		return () => {
			cancelled = true;
			if (requestId === requestSequence.current) {
				requestSequence.current += 1;
			}
		};
	}, [loadKey, offset, open, requestKey, webhookId]);

	const setOffset = (update: number | ((currentOffset: number) => number)) => {
		setPage((currentPage) => {
			const currentOffset = currentPage.webhookId === webhookId ? currentPage.offset : 0;
			return {
				webhookId,
				offset: typeof update === "function" ? update(currentOffset) : update,
			};
		});
	};

	const toggleRow = (id: string) => {
		setExpandedRows((currentRows) => {
			const nextRows = new Set(currentRows);
			if (nextRows.has(id)) {
				nextRows.delete(id);
			} else {
				nextRows.add(id);
			}
			return nextRows;
		});
	};

	return {
		deliveries,
		total,
		offset,
		isLoading,
		hasRequestError: requestError?.requestKey === requestKey,
		errorMessage: requestError?.message,
		shouldShowInitialLoading: open && deliveries.length === 0 && loadedRequestKey !== requestKey,
		expandedRows,
		retry: () => setRetryToken((value) => value + 1),
		setOffset,
		toggleRow,
	};
}
