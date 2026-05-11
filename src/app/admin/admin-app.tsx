"use client";

import Link from "next/link";
import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";
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
	{ label: "全部状态", value: "" },
	{ label: "可取件", value: "available" },
	{ label: "已过期", value: "expired" },
	{ label: "已撤回", value: "deleted" },
	{ label: "次数用尽", value: "depleted" },
];

const kindOptions = [
	{ label: "全部类型", value: "" },
	{ label: "文件", value: "file" },
	{ label: "文本", value: "text" },
];

export default function AdminApp() {
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
			const data = await readApiJson<DeliveriesResponse>(response, "后台列表读取失败。");
			if (!response.ok) {
				throw new Error(data.error ?? "后台列表读取失败。");
			}

			setDeliveries(data.deliveries);
			setTotal(data.total);
			setTotalPages(data.totalPages);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "后台列表读取失败。");
		} finally {
			setBusy(null);
		}
	}, [kind, page, query, status]);

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
			const data = await readApiJson<EventsResponse>(response, "事件读取失败。");
			if (!response.ok) {
				throw new Error(data.error ?? "事件读取失败。");
			}

			setEvents(data.events);
		} catch (error) {
			setEvents([]);
			setMessage(error instanceof Error ? error.message : "事件读取失败。");
		} finally {
			setBusy(null);
		}
	}

	async function revokeDelivery(delivery: AdminDelivery) {
		if (delivery.deletedAt) {
			return;
		}

		setBusy("revoke");
		setMessage("");

		try {
			const response = await fetch(`/api/admin/deliveries/${encodeURIComponent(delivery.id)}/revoke`, {
				method: "POST",
			});
			const data = await readApiJson<ApiError>(response, "撤回失败。");
			if (!response.ok) {
				throw new Error(data.error ?? "撤回失败。");
			}

			setMessage("文件已撤回。");
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
			setMessage(error instanceof Error ? error.message : "撤回失败。");
		} finally {
			setBusy(null);
		}
	}

	async function saveCounts(delivery: AdminDelivery) {
		const maxDownloads = Number(editMaxDownloads);
		const downloadCount = Number(editDownloadCount);

		if (!Number.isInteger(maxDownloads) || maxDownloads < 1 || !Number.isInteger(downloadCount) || downloadCount < 0) {
			setMessage("次数必须是有效整数。");
			return;
		}

		if (downloadCount > maxDownloads) {
			setMessage("已用次数不能大于最大次数。");
			return;
		}

		setBusy("counts");
		setMessage("");

		try {
			const response = await fetch(`/api/admin/deliveries/${encodeURIComponent(delivery.id)}/counts`, {
				method: "PATCH",
				headers: {
					"content-type": "application/json",
				},
				body: JSON.stringify({ maxDownloads, downloadCount }),
			});
			const data = await readApiJson<ApiError>(response, "次数修改失败。");
			if (!response.ok) {
				throw new Error(data.error ?? "次数修改失败。");
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
			setMessage("次数已更新。");
			await loadDeliveries();
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "次数修改失败。");
		} finally {
			setBusy(null);
		}
	}

	return (
		<main className="app-shell min-h-screen">
			<section className="mx-auto flex min-h-screen w-full max-w-[1360px] flex-col gap-6 px-5 pt-6 pb-16 sm:px-8 min-[960px]:px-10">
				<header className="flex flex-wrap items-end justify-between gap-4">
					<div>
						<h1 className="m-0 font-[var(--font-display)] text-[34px] font-normal leading-tight text-[var(--ink)]">管理后台</h1>
						<p className="panel-copy">共 {total} 条上传记录</p>
					</div>
					<Link className="secondary-button inline-flex min-h-10 items-center justify-center rounded-lg px-4 text-sm font-medium no-underline" href="/">
						返回前台
					</Link>
				</header>

				<form className="panel panel-feature grid gap-4 min-[860px]:grid-cols-[minmax(220px,1fr)_180px_180px_auto]" onSubmit={applySearch}>
					<label className="field flex flex-col gap-2">
						<span>搜索</span>
						<input
							className="h-[42px] w-full"
							value={searchInput}
							onChange={(event) => setSearchInput(event.target.value)}
							placeholder="文件名、ID 或 IP"
						/>
					</label>
					<label className="field flex flex-col gap-2">
						<span>状态</span>
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
									{option.label}
								</option>
							))}
						</select>
					</label>
					<label className="field flex flex-col gap-2">
						<span>类型</span>
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
									{option.label}
								</option>
							))}
						</select>
					</label>
					<button className="primary-button inline-flex min-h-10 items-center justify-center self-end rounded-lg px-5 text-sm font-medium" type="submit">
						搜索
					</button>
				</form>

				{message ? <p className="auth-error">{message}</p> : null}

				<section className="panel flex min-w-0 flex-col gap-4 overflow-hidden">
					<div className="overflow-x-auto">
						<table className="admin-table w-full min-w-[1060px] border-collapse text-left text-sm">
							<thead>
								<tr>
									<th>文件</th>
									<th>状态</th>
									<th>大小</th>
									<th>次数</th>
									<th>创建时间</th>
									<th>过期时间</th>
									<th>上传来源</th>
									<th>浏览器</th>
									<th>操作</th>
								</tr>
							</thead>
							<tbody>
								{deliveries.map((delivery) => (
									<tr key={delivery.id}>
										<td>
											<strong>{delivery.fileName}</strong>
											<span>{delivery.kind === "text" ? "文本" : delivery.contentType}</span>
										</td>
										<td>
											<span className={`admin-status admin-status-${delivery.status}`}>{statusLabel(delivery.status)}</span>
											{delivery.deletedReason ? <span>{delivery.deletedReason}</span> : null}
										</td>
										<td>{formatBytes(delivery.size)}</td>
										<td>{delivery.downloadCount}/{delivery.maxDownloads}</td>
										<td>{formatDate(delivery.createdAt)}</td>
										<td>{formatDate(delivery.expiresAt)}</td>
										<td title={delivery.upload.userAgent ?? undefined}>{sourceLocation(delivery.upload)}</td>
										<td>{sourceBrowser(delivery.upload)}</td>
										<td>
											<div className="flex flex-wrap gap-2">
												<button className="secondary-button min-h-9 rounded-lg px-3 text-sm" type="button" onClick={() => loadEvents(delivery)}>
													事件
												</button>
												<button className="secondary-button min-h-9 rounded-lg px-3 text-sm" type="button" onClick={() => beginEdit(delivery)}>
													操作
												</button>
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
						{deliveries.length === 0 ? <p className="panel-copy py-6 text-center">暂无记录</p> : null}
					</div>
					<div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--hairline)] pt-4">
						<span className="panel-copy">第 {page} / {totalPages} 页</span>
						<div className="flex gap-2">
							<button className="secondary-button min-h-9 rounded-lg px-4 text-sm" disabled={page <= 1 || busy === "list"} type="button" onClick={() => setPage((value) => Math.max(1, value - 1))}>
								上一页
							</button>
							<button className="secondary-button min-h-9 rounded-lg px-4 text-sm" disabled={page >= totalPages || busy === "list"} type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>
								下一页
							</button>
						</div>
					</div>
				</section>
			</section>

			{eventDelivery ? (
				<AdminModal title="事件" subtitle={eventDelivery.fileName} onClose={() => setEventDelivery(null)} dark>
					<div className="flex flex-col gap-3">
						{message ? <p className="auth-error">{message}</p> : null}
						{busy === "events" ? <p className="panel-copy">读取中</p> : null}
						{events.map((event) => (
							<div className="admin-event" key={event.id}>
								<div className="flex items-center justify-between gap-3">
									<strong>{actionLabel(event.action)}</strong>
									<span>{formatDate(event.createdAt)}</span>
								</div>
								<p>{sourceLocation(event.source)} · {sourceBrowser(event.source)}</p>
								{event.previousMaxDownloads !== null || event.nextMaxDownloads !== null ? (
									<p>
										次数 {event.previousDownloadCount ?? "-"} / {event.previousMaxDownloads ?? "-"} → {event.nextDownloadCount ?? "-"} / {event.nextMaxDownloads ?? "-"}
									</p>
								) : null}
								{event.note ? <p>{event.note}</p> : null}
							</div>
						))}
						{events.length === 0 && busy !== "events" ? <p className="panel-copy">暂无事件</p> : null}
					</div>
				</AdminModal>
			) : null}

			{actionDelivery ? (
				<AdminModal title="操作" subtitle={actionDelivery.fileName} onClose={() => setActionDelivery(null)}>
					<div className="grid gap-5">
						{message ? <p className="auth-error">{message}</p> : null}
						<div className="grid gap-3 sm:grid-cols-2">
							<label className="field flex flex-col gap-2">
								<span>最大次数</span>
								<input
									className="h-[42px] w-full"
									min={1}
									type="number"
									value={editMaxDownloads}
									onChange={(event) => setEditMaxDownloads(event.target.value)}
								/>
							</label>
							<label className="field flex flex-col gap-2">
								<span>已用次数</span>
								<input
									className="h-[42px] w-full"
									min={0}
									type="number"
									value={editDownloadCount}
									onChange={(event) => setEditDownloadCount(event.target.value)}
								/>
							</label>
						</div>
						<div className="rounded-lg border border-[var(--hairline)] p-4 text-sm text-[var(--muted)]">
							<p className="m-0">当前状态：{statusLabel(actionDelivery.status)}</p>
							<p className="m-0 mt-2">当前次数：{actionDelivery.downloadCount} / {actionDelivery.maxDownloads}</p>
							{actionDelivery.deletedReason ? <p className="m-0 mt-2">删除原因：{actionDelivery.deletedReason}</p> : null}
						</div>
						<div className="flex flex-wrap justify-between gap-3 border-t border-[var(--hairline)] pt-4">
							<button
								className="danger-button inline-flex min-h-10 items-center justify-center rounded-lg px-5 text-sm font-medium"
								disabled={actionDelivery.deletedAt !== null || busy === "revoke"}
								type="button"
								onClick={() => revokeDelivery(actionDelivery)}
							>
								{busy === "revoke" ? "撤回中" : "撤回文件"}
							</button>
							<div className="flex flex-wrap gap-2">
								<button className="secondary-button inline-flex min-h-10 items-center justify-center rounded-lg px-5 text-sm font-medium" type="button" onClick={() => setActionDelivery(null)}>
									关闭
								</button>
								<button
									className="primary-button inline-flex min-h-10 items-center justify-center rounded-lg px-5 text-sm font-medium"
									disabled={busy === "counts"}
									type="button"
									onClick={() => saveCounts(actionDelivery)}
								>
									{busy === "counts" ? "保存中" : "保存次数"}
								</button>
							</div>
						</div>
					</div>
				</AdminModal>
			) : null}
		</main>
	);
}

function AdminModal({
	children,
	dark = false,
	onClose,
	subtitle,
	title,
}: {
	children: ReactNode;
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
					<button className="secondary-button admin-modal-close" type="button" aria-label="关闭弹窗" onClick={onClose}>
						×
					</button>
				</div>
				{children}
			</section>
		</div>
	);
}

function formatDate(value: string) {
	return new Intl.DateTimeFormat("zh-CN", {
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	}).format(new Date(value));
}

function statusLabel(status: AdminStatus) {
	const labels: Record<AdminStatus, string> = {
		available: "可取件",
		expired: "已过期",
		deleted: "已撤回",
		depleted: "次数用尽",
	};
	return labels[status];
}

function actionLabel(action: string) {
	const labels: Record<string, string> = {
		upload: "上传",
		download: "下载",
		admin_revoke: "后台撤回",
		admin_counts_update: "次数修改",
	};
	return labels[action] ?? action;
}

function sourceLocation(source: SourceInfo) {
	const place = [source.country, source.region, source.city].filter(Boolean).join(" ");
	return [source.ip ?? "未知 IP", place].filter(Boolean).join(" · ");
}

function sourceBrowser(source: SourceInfo) {
	return [source.browser, source.os, source.device].filter(Boolean).join(" / ") || "未知";
}
