"use client";

import Link from "next/link";
import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { readApiJson } from "../components/api-json";
import { formatBytes } from "../components/locker-format";

type AdminStatus = "available" | "expired" | "deleted" | "depleted";
type AdminKind = "file" | "text";

type AdminDelivery = {
	id: string;
	fileName: string;
	contentType: string;
	kind: AdminKind;
	size: number;
	maxDownloads: number;
	downloadCount: number;
	remainingDownloads: number;
	expiresAt: string;
	createdAt: string;
	deletedAt: string | null;
	deletedReason: string | null;
	status: AdminStatus;
	upload: SourceInfo;
};

type SourceInfo = {
	ip: string | null;
	userAgent: string | null;
	browser: string | null;
	os: string | null;
	device: string | null;
	country: string | null;
	region: string | null;
	city: string | null;
};

type DeliveryEvent = {
	id: string;
	action: string;
	actor: string;
	note: string | null;
	previousMaxDownloads: number | null;
	previousDownloadCount: number | null;
	nextMaxDownloads: number | null;
	nextDownloadCount: number | null;
	createdAt: string;
	source: SourceInfo;
};

type DeliveriesResponse = {
	deliveries: AdminDelivery[];
	page: number;
	pageSize: number;
	total: number;
	totalPages: number;
	error?: string;
};

type EventsResponse = {
	events: DeliveryEvent[];
	error?: string;
};

type ApiError = {
	error?: string;
};

const statusOptions = [
	{ labelKey: "admin.allStatuses", value: "" },
	{ labelKey: "status.available", value: "available" },
	{ labelKey: "status.expired", value: "expired" },
	{ labelKey: "status.deleted", value: "deleted" },
	{ labelKey: "status.depleted", value: "depleted" },
] as const;

const kindOptions = [
	{ labelKey: "admin.allKinds", value: "" },
	{ labelKey: "admin.kindFile", value: "file" },
	{ labelKey: "admin.kindText", value: "text" },
] as const;

type AdminAppProps = {
	csrfToken: string;
	demoMode?: boolean;
};

type TFunction = ReturnType<typeof useI18n>["t"];

export default function AdminApp({ csrfToken, demoMode = false }: AdminAppProps) {
	const { locale, t } = useI18n();
	const [deliveries, setDeliveries] = useState<AdminDelivery[]>([]);
	const [events, setEvents] = useState<DeliveryEvent[]>([]);
	const [eventDelivery, setEventDelivery] = useState<AdminDelivery | null>(null);
	const [actionDelivery, setActionDelivery] = useState<AdminDelivery | null>(null);
	const [page, setPage] = useState(1);
	const [totalPages, setTotalPages] = useState(1);
	const [total, setTotal] = useState(0);
	const [status, setStatus] = useState("");
	const [kind, setKind] = useState("");
	const [searchInput, setSearchInput] = useState("");
	const [query, setQuery] = useState("");
	const [busy, setBusy] = useState<"list" | "events" | "revoke" | "counts" | null>(null);
	const [message, setMessage] = useState("");
	const [editMaxDownloads, setEditMaxDownloads] = useState("");
	const [editDownloadCount, setEditDownloadCount] = useState("");

	const loadDeliveries = useCallback(async () => {
		setBusy("list");
		setMessage("");

		try {
			const params = new URLSearchParams({
				page: String(page),
				pageSize: "20",
			});
			if (status) {
				params.set("status", status);
			}
			if (kind) {
				params.set("kind", kind);
			}
			if (query) {
				params.set("q", query);
			}

			const response = await fetch(`/api/admin/deliveries?${params.toString()}`);
			const data = await readApiJson<DeliveriesResponse>(response, t("admin.listFailed"));
			if (!response.ok) {
				throw new Error(t("admin.listFailed"));
			}

			setDeliveries(data.deliveries);
			setTotal(data.total);
			setTotalPages(data.totalPages);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : t("admin.listFailed"));
		} finally {
			setBusy(null);
		}
	}, [kind, page, query, status, t]);

	useEffect(() => {
		const timer = window.setTimeout(() => {
			void loadDeliveries();
		}, 0);

		return () => window.clearTimeout(timer);
	}, [loadDeliveries]);

	function applySearch(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setPage(1);
		setQuery(searchInput.trim());
	}

	function beginEdit(delivery: AdminDelivery) {
		if (demoMode) {
			setMessage(t("admin.demoReadonlyMessage"));
			return;
		}

		setActionDelivery(delivery);
		setEditMaxDownloads(String(delivery.maxDownloads));
		setEditDownloadCount(String(delivery.downloadCount));
	}

	async function loadEvents(delivery: AdminDelivery) {
		setBusy("events");
		setMessage("");
		setEvents([]);
		setEventDelivery(delivery);

		try {
			const response = await fetch(`/api/admin/deliveries/${encodeURIComponent(delivery.id)}/events`);
			const data = await readApiJson<EventsResponse>(response, t("admin.eventsFailed"));
			if (!response.ok) {
				throw new Error(t("admin.eventsFailed"));
			}

			setEvents(data.events);
		} catch (error) {
			setEvents([]);
			setMessage(error instanceof Error ? error.message : t("admin.eventsFailed"));
		} finally {
			setBusy(null);
		}
	}

	async function revokeDelivery(delivery: AdminDelivery) {
		if (demoMode) {
			setMessage(t("admin.demoNoRevoke"));
			return;
		}

		if (delivery.deletedAt) {
			return;
		}

		setBusy("revoke");
		setMessage("");

		try {
			const response = await fetch(`/api/admin/deliveries/${encodeURIComponent(delivery.id)}/revoke`, {
				method: "POST",
				headers: csrfHeaders(csrfToken),
			});
			await readApiJson<ApiError>(response, t("message.revokeFailed"));
			if (!response.ok) {
				throw new Error(t("message.revokeFailed"));
			}

			setMessage(t("message.revoked"));
			setActionDelivery((current) =>
				current?.id === delivery.id
					? {
							...current,
							deletedAt: new Date().toISOString(),
							deletedReason: "admin_revoked",
							status: "deleted",
						}
					: current,
			);
			await loadDeliveries();
		} catch (error) {
			setMessage(error instanceof Error ? error.message : t("message.revokeFailed"));
		} finally {
			setBusy(null);
		}
	}

	async function saveCounts(delivery: AdminDelivery) {
		if (demoMode) {
			setMessage(t("admin.demoNoCounts"));
			return;
		}

		const maxDownloads = Number(editMaxDownloads);
		const downloadCount = Number(editDownloadCount);

		if (!Number.isInteger(maxDownloads) || maxDownloads < 1 || !Number.isInteger(downloadCount) || downloadCount < 0) {
			setMessage(t("admin.invalidCounts"));
			return;
		}

		if (downloadCount > maxDownloads) {
			setMessage(t("admin.countExceeded"));
			return;
		}

		setBusy("counts");
		setMessage("");

		try {
			const response = await fetch(`/api/admin/deliveries/${encodeURIComponent(delivery.id)}/counts`, {
				method: "PATCH",
				headers: {
					"content-type": "application/json",
					...csrfHeaders(csrfToken),
				},
				body: JSON.stringify({ maxDownloads, downloadCount }),
			});
			await readApiJson<ApiError>(response, t("admin.countsFailed"));
			if (!response.ok) {
				throw new Error(t("admin.countsFailed"));
			}

			setActionDelivery((current) =>
				current?.id === delivery.id
					? {
							...current,
							maxDownloads,
							downloadCount,
							remainingDownloads: Math.max(0, maxDownloads - downloadCount),
							status:
								current.deletedAt === null && current.status === "available" && downloadCount >= maxDownloads
									? "deleted"
									: current.status,
							deletedAt:
								current.deletedAt === null && current.status === "available" && downloadCount >= maxDownloads
									? new Date().toISOString()
									: current.deletedAt,
							deletedReason:
								current.deletedAt === null && current.status === "available" && downloadCount >= maxDownloads
									? "admin_count_limit"
									: current.deletedReason,
						}
					: current,
			);
			setMessage(t("admin.countsUpdated"));
			await loadDeliveries();
		} catch (error) {
			setMessage(error instanceof Error ? error.message : t("admin.countsFailed"));
		} finally {
			setBusy(null);
		}
	}

	return (
		<main className="app-shell min-h-screen">
			<section className="mx-auto flex min-h-screen w-full max-w-[1360px] flex-col gap-6 px-5 pt-6 pb-16 sm:px-8 min-[960px]:px-10">
				<header className="flex flex-wrap items-end justify-between gap-4">
					<div>
						<h1 className="m-0 font-[var(--font-display)] text-[34px] font-normal leading-tight text-[var(--ink)]">{t("admin.title")}</h1>
						<p className="panel-copy">{demoMode ? t("admin.demoPrefix") : ""}{t("admin.totalUploads", { total })}</p>
					</div>
					<Link className="secondary-button inline-flex min-h-10 items-center justify-center rounded-lg px-4 text-sm font-medium no-underline" href="/">
						{t("admin.backHome")}
					</Link>
				</header>

				<form className="panel panel-feature grid gap-4 min-[860px]:grid-cols-[minmax(220px,1fr)_180px_180px_auto]" onSubmit={applySearch}>
					<label className="field flex flex-col gap-2">
						<span>{t("admin.search")}</span>
						<input
							className="h-[42px] w-full"
							value={searchInput}
							onChange={(event) => setSearchInput(event.target.value)}
							placeholder={t("admin.searchPlaceholder")}
						/>
					</label>
					<label className="field flex flex-col gap-2">
						<span>{t("admin.status")}</span>
						<select
							className="h-[42px] w-full"
							value={status}
							onChange={(event) => {
								setPage(1);
								setStatus(event.target.value);
							}}
						>
							{statusOptions.map((option) => (
								<option key={option.value} value={option.value}>
									{t(option.labelKey)}
								</option>
							))}
						</select>
					</label>
					<label className="field flex flex-col gap-2">
						<span>{t("admin.kind")}</span>
						<select
							className="h-[42px] w-full"
							value={kind}
							onChange={(event) => {
								setPage(1);
								setKind(event.target.value);
							}}
						>
							{kindOptions.map((option) => (
								<option key={option.value} value={option.value}>
									{t(option.labelKey)}
								</option>
							))}
						</select>
					</label>
					<button className="primary-button inline-flex min-h-10 items-center justify-center self-end rounded-lg px-5 text-sm font-medium" type="submit">
						{t("admin.search")}
					</button>
				</form>

				{message ? <p className="auth-error">{message}</p> : null}

				<section className="panel flex min-w-0 flex-col gap-4 overflow-hidden">
					<div className="overflow-x-auto">
						<table className="admin-table w-full min-w-[1060px] border-collapse text-left text-sm">
							<thead>
								<tr>
									<th>{t("admin.headerFile")}</th>
									<th>{t("admin.status")}</th>
									<th>{t("admin.headerSize")}</th>
									<th>{t("admin.headerCounts")}</th>
									<th>{t("admin.headerCreated")}</th>
									<th>{t("admin.headerExpires")}</th>
									<th>{t("admin.headerSource")}</th>
									<th>{t("admin.headerBrowser")}</th>
									<th>{t("admin.headerActions")}</th>
								</tr>
							</thead>
							<tbody>
								{deliveries.map((delivery) => (
									<tr key={delivery.id}>
										<td>
											<strong>{delivery.fileName}</strong>
											<span>{delivery.kind === "text" ? t("admin.kindText") : delivery.contentType}</span>
										</td>
										<td>
											<span className={`admin-status admin-status-${delivery.status}`}>{statusLabel(delivery.status, t)}</span>
											{delivery.deletedReason ? <span>{delivery.deletedReason}</span> : null}
										</td>
										<td>{formatBytes(delivery.size)}</td>
										<td>{delivery.downloadCount}/{delivery.maxDownloads}</td>
										<td>{formatDate(delivery.createdAt, locale)}</td>
										<td>{formatDate(delivery.expiresAt, locale)}</td>
										<td title={delivery.upload.userAgent ?? undefined}>{sourceLocation(delivery.upload, t)}</td>
										<td>{sourceBrowser(delivery.upload, t)}</td>
										<td>
											<div className="flex flex-wrap gap-2">
												<button className="secondary-button min-h-9 rounded-lg px-3 text-sm" type="button" onClick={() => loadEvents(delivery)}>
													{t("admin.events")}
												</button>
												<button className="secondary-button min-h-9 rounded-lg px-3 text-sm" disabled={demoMode} type="button" onClick={() => beginEdit(delivery)}>
													{demoMode ? t("admin.readonly") : t("admin.actions")}
												</button>
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
						{deliveries.length === 0 ? <p className="panel-copy py-6 text-center">{t("common.none")}</p> : null}
					</div>
					<div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--hairline)] pt-4">
						<span className="panel-copy">{t("admin.page", { page, totalPages })}</span>
						<div className="flex gap-2">
							<button className="secondary-button min-h-9 rounded-lg px-4 text-sm" disabled={page <= 1 || busy === "list"} type="button" onClick={() => setPage((value) => Math.max(1, value - 1))}>
								{t("admin.prevPage")}
							</button>
							<button className="secondary-button min-h-9 rounded-lg px-4 text-sm" disabled={page >= totalPages || busy === "list"} type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>
								{t("admin.nextPage")}
							</button>
						</div>
					</div>
				</section>
			</section>

			{eventDelivery ? (
				<AdminModal title={t("admin.events")} subtitle={eventDelivery.fileName} closeLabel={t("common.close")} onClose={() => setEventDelivery(null)} dark>
					<div className="flex flex-col gap-3">
						{message ? <p className="auth-error">{message}</p> : null}
						{busy === "events" ? <p className="panel-copy">{t("common.loading")}</p> : null}
						{events.map((event) => (
							<div className="admin-event" key={event.id}>
								<div className="flex items-center justify-between gap-3">
									<strong>{actionLabel(event.action, t)}</strong>
									<span>{formatDate(event.createdAt, locale)}</span>
								</div>
								<p>{sourceLocation(event.source, t)} · {sourceBrowser(event.source, t)}</p>
								{event.previousMaxDownloads !== null || event.nextMaxDownloads !== null ? (
									<p>
										{t("admin.headerCounts")} {event.previousDownloadCount ?? "-"} / {event.previousMaxDownloads ?? "-"} → {event.nextDownloadCount ?? "-"} / {event.nextMaxDownloads ?? "-"}
									</p>
								) : null}
								{event.note ? <p>{event.note}</p> : null}
							</div>
						))}
						{events.length === 0 && busy !== "events" ? <p className="panel-copy">{t("common.noEvents")}</p> : null}
					</div>
				</AdminModal>
			) : null}

			{actionDelivery ? (
				<AdminModal title={t("admin.actions")} subtitle={actionDelivery.fileName} closeLabel={t("common.close")} onClose={() => setActionDelivery(null)}>
					<div className="grid gap-5">
						{message ? <p className="auth-error">{message}</p> : null}
						<div className="grid gap-3 sm:grid-cols-2">
							<label className="field flex flex-col gap-2">
								<span>{t("admin.maxDownloads")}</span>
								<input
									className="h-[42px] w-full"
									disabled={demoMode}
									min={1}
									type="number"
									value={editMaxDownloads}
									onChange={(event) => setEditMaxDownloads(event.target.value)}
								/>
							</label>
							<label className="field flex flex-col gap-2">
								<span>{t("admin.usedDownloads")}</span>
								<input
									className="h-[42px] w-full"
									disabled={demoMode}
									min={0}
									type="number"
									value={editDownloadCount}
									onChange={(event) => setEditDownloadCount(event.target.value)}
								/>
							</label>
						</div>
						<div className="rounded-lg border border-[var(--hairline)] p-4 text-sm text-[var(--muted)]">
							<p className="m-0">{t("admin.currentStatus", { status: statusLabel(actionDelivery.status, t) })}</p>
							<p className="m-0 mt-2">{t("admin.currentCounts", { downloadCount: actionDelivery.downloadCount, maxDownloads: actionDelivery.maxDownloads })}</p>
							{actionDelivery.deletedReason ? <p className="m-0 mt-2">{t("admin.deletedReason", { reason: actionDelivery.deletedReason })}</p> : null}
						</div>
						<div className="flex flex-wrap justify-between gap-3 border-t border-[var(--hairline)] pt-4">
							<button
								className="danger-button inline-flex min-h-10 items-center justify-center rounded-lg px-5 text-sm font-medium"
								disabled={demoMode || actionDelivery.deletedAt !== null || busy === "revoke"}
								type="button"
								onClick={() => revokeDelivery(actionDelivery)}
							>
								{busy === "revoke" ? t("admin.revoking") : t("admin.revokeFile")}
							</button>
							<div className="flex flex-wrap gap-2">
								<button className="secondary-button inline-flex min-h-10 items-center justify-center rounded-lg px-5 text-sm font-medium" type="button" onClick={() => setActionDelivery(null)}>
									{t("common.close")}
								</button>
								<button
									className="primary-button inline-flex min-h-10 items-center justify-center rounded-lg px-5 text-sm font-medium"
									disabled={demoMode || busy === "counts"}
									type="button"
									onClick={() => saveCounts(actionDelivery)}
								>
									{busy === "counts" ? t("admin.saving") : t("admin.saveCounts")}
								</button>
							</div>
						</div>
					</div>
				</AdminModal>
			) : null}
		</main>
	);
}

function csrfHeaders(csrfToken: string): Record<string, string> {
	return csrfToken ? { "x-csrf-token": csrfToken } : {};
}

function AdminModal({
	children,
	closeLabel,
	dark = false,
	onClose,
	subtitle,
	title,
}: {
	children: ReactNode;
	closeLabel: string;
	dark?: boolean;
	onClose: () => void;
	subtitle: string;
	title: string;
}) {
	useEffect(() => {
		function closeOnEscape(event: KeyboardEvent) {
			if (event.key === "Escape") {
				onClose();
			}
		}

		window.addEventListener("keydown", closeOnEscape);
		return () => window.removeEventListener("keydown", closeOnEscape);
	}, [onClose]);

	return (
		<div className="admin-modal-backdrop" role="presentation" onMouseDown={onClose}>
			<section
				aria-modal="true"
				className={`admin-modal ${dark ? "panel-dark" : ""}`}
				role="dialog"
				onMouseDown={(event) => event.stopPropagation()}
			>
				<div className="flex items-start justify-between gap-4">
					<div>
						<h2>{title}</h2>
						<p className="panel-copy">{subtitle}</p>
					</div>
					<button className="secondary-button admin-modal-close" type="button" aria-label={closeLabel} onClick={onClose}>
						×
					</button>
				</div>
				{children}
			</section>
		</div>
	);
}

function formatDate(value: string, locale: string) {
	return new Intl.DateTimeFormat(locale, {
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	}).format(new Date(value));
}

function statusLabel(status: AdminStatus, t: TFunction) {
	const labels: Record<AdminStatus, string> = {
		available: t("status.available"),
		expired: t("status.expired"),
		deleted: t("status.deleted"),
		depleted: t("status.depleted"),
	};
	return labels[status];
}

function actionLabel(action: string, t: TFunction) {
	const labels: Record<string, string> = {
		upload: t("event.upload"),
		download: t("event.download"),
		admin_revoke: t("event.admin_revoke"),
		admin_counts_update: t("event.admin_counts_update"),
	};
	return labels[action] ?? action;
}

function sourceLocation(source: SourceInfo, t: TFunction) {
	const place = [source.country, source.region, source.city].filter(Boolean).join(" ");
	return [source.ip ?? t("common.unknownIp"), place].filter(Boolean).join(" · ");
}

function sourceBrowser(source: SourceInfo, t: TFunction) {
	return [source.browser, source.os, source.device].filter(Boolean).join(" / ") || t("common.unknown");
}
