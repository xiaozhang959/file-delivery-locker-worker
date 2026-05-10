"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { GooeyToaster, gooeyToast } from "goey-toast";

type UploadResult = {
	id: string;
	pickupCode: string;
	manageCode: string;
	fileName: string;
	kind: DeliveryKind;
	size: number;
	maxDownloads: number;
	expiresAt: string;
	pickupUrl: string;
	downloadUrl: string;
};

type Delivery = {
	id: string;
	fileName: string;
	contentType: string;
	kind: DeliveryKind;
	size: number;
	maxDownloads: number;
	downloadCount: number;
	remainingDownloads: number;
	expiresAt: string;
	createdAt: string;
	status: "available" | "expired" | "deleted" | "depleted";
};

type ApiError = {
	error?: string;
};

type DeliveryKind = "file" | "text";

type TextPreview = {
	text: string;
	remainingDownloads: number;
};

const MAX_TEXT_SIZE = 256 * 1024;
const TEXT_FILE_NAME = "寄存文本.txt";

const expiryOptions = [
	{ label: "1 小时", value: 1 },
	{ label: "24 小时", value: 24 },
	{ label: "7 天", value: 168 },
];

const statusText: Record<Delivery["status"], string> = {
	available: "可取件",
	deleted: "已撤回",
	depleted: "次数已用尽",
	expired: "已过期",
};

export default function Home() {
	const [deliveryMode, setDeliveryMode] = useState<DeliveryKind>("file");
	const [file, setFile] = useState<File | null>(null);
	const [textContent, setTextContent] = useState("");
	const [expiresInHours, setExpiresInHours] = useState(24);
	const [maxDownloadsInput, setMaxDownloadsInput] = useState("1");
	const [pickupCode, setPickupCode] = useState("");
	const [manageCode, setManageCode] = useState("");
	const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
	const [delivery, setDelivery] = useState<Delivery | null>(null);
	const [textPreview, setTextPreview] = useState<TextPreview | null>(null);
	const [busy, setBusy] = useState<"upload" | "lookup" | "revoke" | null>(null);

	const selectedFileSize = useMemo(() => (file ? formatBytes(file.size) : "未选择"), [file]);
	const textSize = useMemo(() => formatBytes(new TextEncoder().encode(textContent).length), [textContent]);
	const uploadBadge = deliveryMode === "text" ? textSize : selectedFileSize;

	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const code = params.get("pickupCode");
		if (code) {
			const frame = window.requestAnimationFrame(() => setPickupCode(code.toUpperCase()));
			return () => window.cancelAnimationFrame(frame);
		}
	}, []);

	function notify(message: string, type: "default" | "success" | "error" | "warning" = "default") {
		const options = { preset: "subtle" as const, showTimestamp: false, showProgress: true };

		if (type === "success") {
			gooeyToast.success(message, options);
			return;
		}

		if (type === "error") {
			gooeyToast.error(message, options);
			return;
		}

		if (type === "warning") {
			gooeyToast.warning(message, options);
			return;
		}

		gooeyToast(message, options);
	}

	async function uploadDelivery(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		gooeyToast.dismiss();
		setUploadResult(null);
		setTextPreview(null);

		let body: BodyInit;
		let fileName: string;
		let contentType: string;
		const maxDownloads = Number(maxDownloadsInput);

		if (!Number.isInteger(maxDownloads) || maxDownloads < 1 || maxDownloads > 10) {
			notify("下载次数请输入 1 到 10 的整数。", "warning");
			return;
		}

		if (deliveryMode === "text") {
			const textBytes = new TextEncoder().encode(textContent);

			if (!textContent.trim()) {
				notify("请输入要寄存的文本。", "warning");
				return;
			}

			if (textBytes.length > MAX_TEXT_SIZE) {
				notify("文本不能超过 256 KB。", "warning");
				return;
			}

			contentType = "text/plain;charset=utf-8";
			fileName = TEXT_FILE_NAME;
			body = new Blob([textContent], { type: contentType });
		} else {
			if (!file) {
				notify("请选择一个文件。", "warning");
				return;
			}

			if (file.size > 100 * 1024 * 1024) {
				notify("文件不能超过 100 MB。", "warning");
				return;
			}

			contentType = file.type || "application/octet-stream";
			fileName = file.name;
			body = file;
		}

		setBusy("upload");
		try {
			const response = await fetch("/api/deliveries", {
				method: "POST",
				headers: {
					"content-type": contentType,
					"x-content-type": contentType,
					"x-delivery-kind": deliveryMode,
					"x-expires-in-hours": String(expiresInHours),
					"x-file-name": encodeURIComponent(fileName),
					"x-max-downloads": String(maxDownloads),
				},
				body,
			});
			const data = (await response.json()) as ApiError & UploadResult;
			if (!response.ok) {
				throw new Error(data.error ?? "上传失败。");
			}

			setUploadResult(data);
			setPickupCode(data.pickupCode);
			setManageCode(data.manageCode);
			notify(deliveryMode === "text" ? "文本已入柜。" : "文件已入柜。", "success");
		} catch (error) {
			notify(error instanceof Error ? error.message : "上传失败。", "error");
		} finally {
			setBusy(null);
		}
	}

	async function lookupDelivery(event?: FormEvent<HTMLFormElement>) {
		event?.preventDefault();
		const code = pickupCode.trim();
		setDelivery(null);
		setTextPreview(null);
		gooeyToast.dismiss();

		if (!code) {
			notify("请输入取件码。", "warning");
			return;
		}

		setBusy("lookup");
		try {
			const response = await fetch(`/api/deliveries/${encodeURIComponent(code)}`);
			const data = (await response.json()) as ApiError & { delivery: Delivery };
			if (!response.ok) {
				throw new Error(data.error ?? "没有找到这个文件。");
			}

			setDelivery(data.delivery);
			if (data.delivery.kind === "text" && data.delivery.status === "available") {
				await previewTextDelivery(code);
			}
		} catch (error) {
			setDelivery(null);
			setTextPreview(null);
			notify(error instanceof Error ? error.message : "查询失败。", "error");
		} finally {
			setBusy(null);
		}
	}

	async function previewTextDelivery(code: string) {
		const response = await fetch(`/api/deliveries/${encodeURIComponent(code)}/preview`);
		const data = (await response.json()) as ApiError & TextPreview;
		if (!response.ok) {
			throw new Error(data.error ?? "文本预览失败。");
		}

		setTextPreview({
			text: data.text,
			remainingDownloads: data.remainingDownloads,
		});
	}

	async function revokeDelivery(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const code = manageCode.trim();
		gooeyToast.dismiss();

		if (!code) {
			notify("请输入管理码。", "warning");
			return;
		}

		setBusy("revoke");
		try {
			const response = await fetch(`/api/deliveries/manage/${encodeURIComponent(code)}`, {
				method: "DELETE",
			});
			const data = (await response.json()) as ApiError;
			if (!response.ok) {
				throw new Error(data.error ?? "撤回失败。");
			}

			notify("文件已撤回。", "success");
			setDelivery(null);
		} catch (error) {
			notify(error instanceof Error ? error.message : "撤回失败。", "error");
		} finally {
			setBusy(null);
		}
	}

	function copy(value: string) {
		void navigator.clipboard.writeText(value);
		notify("已复制。", "success");
	}

	return (
		<main className="app-shell">
			<section className="page-shell">
				<div className="workspace-grid">
					<form className="panel panel-feature flex flex-col gap-6" onSubmit={uploadDelivery}>
						<div className="flex items-center justify-between gap-4">
							<div>
								<h2>寄件</h2>
								<p className="panel-copy">
									{deliveryMode === "text" ? "输入一段文本放入快递柜" : file?.name ?? "选择一个文件放入快递柜"}
								</p>
							</div>
							<span className="badge-coral">{uploadBadge}</span>
						</div>

						<div className="mode-switch-row">
							<span className={deliveryMode === "file" ? "active" : undefined}>上传文件</span>
							<button
								type="button"
								className="mode-switch"
								role="switch"
								aria-checked={deliveryMode === "text"}
								aria-label="切换寄件类型"
								onClick={() => setDeliveryMode(deliveryMode === "text" ? "file" : "text")}
							>
								<span className="switch-track" aria-hidden="true">
									<span className="switch-thumb" />
								</span>
							</button>
							<span className={deliveryMode === "text" ? "active" : undefined}>寄存文本</span>
						</div>

						{deliveryMode === "text" ? (
							<label className="field">
								<textarea
									value={textContent}
									onChange={(event) => setTextContent(event.target.value)}
									placeholder="输入要寄存的纯文本"
								/>
							</label>
						) : (
							<label className="dropzone">
								<input
									className="sr-only"
									type="file"
									onChange={(event) => setFile(event.target.files?.[0] ?? null)}
								/>
								<span className="text-4xl">+</span>
								<span className="font-medium">选择文件</span>
							</label>
						)}

						<div className="grid gap-4 sm:grid-cols-2">
							<label className="field">
								<span>保存期限</span>
								<select value={expiresInHours} onChange={(event) => setExpiresInHours(Number(event.target.value))}>
									{expiryOptions.map((option) => (
										<option key={option.value} value={option.value}>
											{option.label}
										</option>
									))}
								</select>
							</label>
							<label className="field">
								<span>下载次数</span>
								<input
									max={10}
									min={1}
									step={1}
									type="number"
									value={maxDownloadsInput}
									onChange={(event) => setMaxDownloadsInput(event.target.value)}
								/>
							</label>
						</div>

						<button className="primary-button" disabled={busy === "upload"} type="submit">
							<span aria-hidden="true">↑</span>
							{busy === "upload" ? "上传中" : "放入快递柜"}
						</button>

						{uploadResult && (
							<div className="result-grid">
								<CodeBlock label="取件码" value={uploadResult.pickupCode} onCopy={copy} />
								<CodeBlock label="管理码" value={uploadResult.manageCode} onCopy={copy} />
								<CodeBlock label="取件链接" value={uploadResult.pickupUrl} onCopy={copy} wide />
							</div>
						)}
					</form>

					<div className="flex flex-col gap-6">
						<form className="panel panel-dark flex flex-col gap-5" onSubmit={lookupDelivery}>
							<div>
								<h2>取件</h2>
								<p className="panel-copy">输入取件码查看文件状态</p>
							</div>
							<label className="field">
								<span>取件码</span>
								<input
									autoCapitalize="characters"
									value={pickupCode}
									onChange={(event) => setPickupCode(event.target.value.toUpperCase())}
									placeholder="例如 A1B2C3D4E5F6"
								/>
							</label>
							<button className="secondary-button" disabled={busy === "lookup"} type="submit">
								<span aria-hidden="true">⌕</span>
								{busy === "lookup" ? "查询中" : "查询文件"}
							</button>

							{delivery && (
								<div className="delivery-box">
									<div className="flex items-start justify-between gap-4">
										<div className="min-w-0">
											<p className="truncate font-semibold">{delivery.fileName}</p>
											<p className="panel-copy">{formatBytes(delivery.size)}</p>
										</div>
										<span className="status-pill">{statusText[delivery.status]}</span>
									</div>
									<div className="grid grid-cols-2 gap-3 text-sm">
										<Mini
											label="剩余"
											value={`${
												delivery.kind === "text" && textPreview
													? textPreview.remainingDownloads
													: delivery.remainingDownloads
											}/${delivery.maxDownloads}`}
										/>
										<Mini label="过期" value={formatTime(delivery.expiresAt)} />
									</div>
									{delivery.kind === "text" ? (
										delivery.status === "available" ? (
											<div className="text-preview">
												<div className="flex items-center justify-between gap-3">
													<span>文本预览</span>
													{typeof textPreview?.remainingDownloads === "number" && (
														<small>剩余 {textPreview.remainingDownloads} 次</small>
													)}
												</div>
												<pre>{textPreview?.text ?? "正在读取文本..."}</pre>
												<button
													className="secondary-button justify-center"
													disabled={!textPreview}
													type="button"
													onClick={() => textPreview && copy(textPreview.text)}
												>
													<span aria-hidden="true">⧉</span>
													复制文本
												</button>
											</div>
										) : null
									) : (
										<a
											className="primary-button justify-center"
											aria-disabled={delivery.status !== "available"}
											href={
												delivery.status === "available"
													? `/api/deliveries/${encodeURIComponent(pickupCode.trim())}/download`
													: undefined
											}
										>
											<span aria-hidden="true">↓</span>
											下载文件
										</a>
									)}
								</div>
							)}
						</form>

						<form className="panel flex flex-col gap-5" onSubmit={revokeDelivery}>
							<div>
								<h2>管理</h2>
								<p className="panel-copy">使用管理码撤回文件</p>
							</div>
							<label className="field">
								<span>管理码</span>
								<input
									autoCapitalize="characters"
									value={manageCode}
									onChange={(event) => setManageCode(event.target.value.toUpperCase())}
									placeholder="创建后显示一次"
								/>
							</label>
							<button className="danger-button" disabled={busy === "revoke"} type="submit">
								<span aria-hidden="true">×</span>
								{busy === "revoke" ? "撤回中" : "撤回文件"}
							</button>
						</form>
					</div>
				</div>

				<GooeyToaster closeButton="top-right" position="bottom-right" preset="subtle" showProgress visibleToasts={3} />
			</section>
		</main>
	);
}

function CodeBlock({
	label,
	onCopy,
	value,
	wide,
}: {
	label: string;
	onCopy: (value: string) => void;
	value: string;
	wide?: boolean;
}) {
	return (
		<div className={wide ? "code-block sm:col-span-2" : "code-block"}>
			<span>{label}</span>
			<button type="button" onClick={() => onCopy(value)} title={`复制${label}`}>
				{value}
			</button>
		</div>
	);
}

function Mini({ label, value }: { label: string; value: string }) {
	return (
		<div className="mini-card">
			<p>{label}</p>
			<strong>{value}</strong>
		</div>
	);
}

function formatBytes(value: number) {
	if (value < 1024) {
		return `${value} B`;
	}

	const units = ["KB", "MB", "GB"];
	let size = value / 1024;
	let index = 0;
	while (size >= 1024 && index < units.length - 1) {
		size /= 1024;
		index += 1;
	}

	return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[index]}`;
}

function formatTime(value: string) {
	return new Intl.DateTimeFormat("zh-CN", {
		dateStyle: "short",
		timeStyle: "short",
	}).format(new Date(value));
}
