"use client";

import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
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
	const [selectedDelivery, setSelectedDelivery] = useState<AdminDelivery | null>(null);
	const [page, setPage] = useState(1);
	const [totalPages, setTotalPages] = useState(1);
	const [total, setTotal] = useState(0);
	const [status, setStatus] = useState("");
	const [kind, setKind] = useState("");
	const [searchInput, setSearchInput] = useState("");
	const [query, setQuery] = useState("");
	const [busy, setBusy] = useState<"list" | "events" | "revoke" | "counts" | null>(null);
	const [message, setMessage] = useState("");
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editMaxDownloads, setEditMaxDownloads] = useState("");
	const [editDownloadCount, setEditDownloadCount] = useState("");

	const selectedTitle = useMemo(() => selectedDelivery?.fileName ?? "选择一条记录查看事件", [selectedDelivery]);

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
		setEditingId(delivery.id);
		setEditMaxDownloads(String(delivery.maxDownloads));
		setEditDownloadCount(String(delivery.downloadCount));
	}

	async function loadEvents(delivery: AdminDelivery) {
		setBusy("events");
		setMessage("");
		setSelectedDelivery(delivery);

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
		if (delivery.deletedAt || !window.confirm(`确认撤回「${delivery.fileName}」？`)) {
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
			await loadDeliveries();
			if (selectedDelivery?.id === delivery.id) {
				await loadEvents(delivery);
			}
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

			setEditingId(null);
			setMessage("次数已更新。");
			await loadDeliveries();
			if (selectedDelivery?.id === delivery.id) {
				await loadEvents(delivery);
			}
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

				<div className="grid gap-6 min-[1120px]:grid-cols-[minmax(0,1fr)_380px] min-[1120px]:items-start">
					<section className="panel flex min-w-0 flex-col gap-4 overflow-hidden">
						<div className="overflow-x-auto">
							<table className="admin-table w-full min-w-[1120px] border-collapse text-left text-sm">
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
											<td>
												{editingId === delivery.id ? (
													<div className="flex min-w-[160px] items-center gap-2">
														<input
															className="h-9 w-16"
															min={1}
															type="number"
															value={editMaxDownloads}
															onChange={(event) => setEditMaxDownloads(event.target.value)}
															aria-label="最大次数"
														/>
														<span>/</span>
														<input
															className="h-9 w-16"
															min={0}
															type="number"
															value={editDownloadCount}
															onChange={(event) => setEditDownloadCount(event.target.value)}
															aria-label="已用次数"
														/>
													</div>
												) : (
													`${delivery.downloadCount}/${delivery.maxDownloads}`
												)}
											</td>
											<td>{formatDate(delivery.createdAt)}</td>
											<td>{formatDate(delivery.expiresAt)}</td>
											<td title={delivery.upload.userAgent ?? undefined}>{sourceLocation(delivery.upload)}</td>
											<td>{sourceBrowser(delivery.upload)}</td>
											<td>
												<div className="flex flex-wrap gap-2">
													<button className="secondary-button min-h-9 rounded-lg px-3 text-sm" type="button" onClick={() => loadEvents(delivery)}>
														事件
													</button>
													{editingId === delivery.id ? (
														<>
															<button className="primary-button min-h-9 rounded-lg px-3 text-sm" type="button" onClick={() => saveCounts(delivery)}>
																保存
															</button>
															<button className="secondary-button min-h-9 rounded-lg px-3 text-sm" type="button" onClick={() => setEditingId(null)}>
																取消
															</button>
														</>
													) : (
														<button className="secondary-button min-h-9 rounded-lg px-3 text-sm" type="button" onClick={() => beginEdit(delivery)}>
															次数
														</button>
													)}
													<button
														className="danger-button min-h-9 rounded-lg px-3 text-sm"
														disabled={delivery.deletedAt !== null}
														type="button"
														onClick={() => revokeDelivery(delivery)}
													>
														撤回
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

					<aside className="panel panel-dark flex flex-col gap-4">
						<div>
							<h2>事件</h2>
							<p className="panel-copy">{selectedTitle}</p>
						</div>
						<div className="flex flex-col gap-3">
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
							{selectedDelivery && events.length === 0 && busy !== "events" ? <p className="panel-copy">暂无事件</p> : null}
						</div>
					</aside>
				</div>
			</section>
		</main>
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
