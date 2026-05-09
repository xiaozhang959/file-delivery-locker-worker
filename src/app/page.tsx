"use client";

import { type FormEvent, useMemo, useState } from "react";

type UploadResult = {
	id: string;
	pickupCode: string;
	manageCode: string;
	fileName: string;
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
	const [file, setFile] = useState<File | null>(null);
	const [expiresInHours, setExpiresInHours] = useState(24);
	const [maxDownloads, setMaxDownloads] = useState(1);
	const [pickupCode, setPickupCode] = useState("");
	const [manageCode, setManageCode] = useState("");
	const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
	const [delivery, setDelivery] = useState<Delivery | null>(null);
	const [notice, setNotice] = useState("");
	const [busy, setBusy] = useState<"upload" | "lookup" | "revoke" | null>(null);

	const selectedFileSize = useMemo(() => (file ? formatBytes(file.size) : "未选择"), [file]);

	async function uploadDelivery(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setNotice("");
		setUploadResult(null);

		if (!file) {
			setNotice("请选择一个文件。");
			return;
		}

		if (file.size > 100 * 1024 * 1024) {
			setNotice("文件不能超过 100 MB。");
			return;
		}

		setBusy("upload");
		try {
			const response = await fetch("/api/deliveries", {
				method: "POST",
				headers: {
					"content-type": file.type || "application/octet-stream",
					"x-content-type": file.type || "application/octet-stream",
					"x-expires-in-hours": String(expiresInHours),
					"x-file-name": encodeURIComponent(file.name),
					"x-max-downloads": String(maxDownloads),
				},
				body: file,
			});
			const data = (await response.json()) as ApiError & UploadResult;
			if (!response.ok) {
				throw new Error(data.error ?? "上传失败。");
			}

			setUploadResult(data);
			setPickupCode(data.pickupCode);
			setManageCode(data.manageCode);
			setNotice("文件已入柜。");
		} catch (error) {
			setNotice(error instanceof Error ? error.message : "上传失败。");
		} finally {
			setBusy(null);
		}
	}

	async function lookupDelivery(event?: FormEvent<HTMLFormElement>) {
		event?.preventDefault();
		const code = pickupCode.trim();
		setDelivery(null);
		setNotice("");

		if (!code) {
			setNotice("请输入取件码。");
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
		} catch (error) {
			setNotice(error instanceof Error ? error.message : "查询失败。");
		} finally {
			setBusy(null);
		}
	}

	async function revokeDelivery(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const code = manageCode.trim();
		setNotice("");

		if (!code) {
			setNotice("请输入管理码。");
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

			setNotice("文件已撤回。");
			setDelivery(null);
		} catch (error) {
			setNotice(error instanceof Error ? error.message : "撤回失败。");
		} finally {
			setBusy(null);
		}
	}

	function copy(value: string) {
		void navigator.clipboard.writeText(value);
		setNotice("已复制。");
	}

	return (
		<main className="min-h-screen bg-[#f5f7f1] text-[#18221f]">
			<section className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-5 py-8 sm:px-8 lg:px-10">
				<header className="flex flex-col gap-3 border-b border-[#d8ded0] pb-6 sm:flex-row sm:items-end sm:justify-between">
					<div>
						<p className="text-sm font-medium text-[#637064]">R2 + D1</p>
						<h1 className="text-3xl font-semibold tracking-normal text-[#10201b] sm:text-5xl">文件快递柜</h1>
					</div>
					<div className="grid grid-cols-3 gap-2 text-center text-sm">
						<Metric label="上限" value="100 MB" />
						<Metric label="期限" value="1h-7d" />
						<Metric label="次数" value="1-10" />
					</div>
				</header>

				<div className="grid flex-1 gap-6 lg:grid-cols-[1.1fr_0.9fr]">
					<form className="panel flex flex-col gap-6" onSubmit={uploadDelivery}>
						<div className="flex items-center justify-between gap-4">
							<div>
								<h2 className="text-xl font-semibold">寄件</h2>
								<p className="mt-1 text-sm text-[#64716a]">{file?.name ?? "选择一个文件放入快递柜"}</p>
							</div>
							<span className="rounded-full bg-[#dceade] px-3 py-1 text-sm font-medium text-[#24472e]">{selectedFileSize}</span>
						</div>

						<label className="dropzone">
							<input
								className="sr-only"
								type="file"
								onChange={(event) => setFile(event.target.files?.[0] ?? null)}
							/>
							<span className="text-4xl">+</span>
							<span className="font-medium">选择文件</span>
						</label>

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
									type="number"
									value={maxDownloads}
									onChange={(event) => setMaxDownloads(Number(event.target.value))}
								/>
							</label>
						</div>

						<button className="primary-button" disabled={busy === "upload"} type="submit">
							<span>↑</span>
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
						<form className="panel flex flex-col gap-5" onSubmit={lookupDelivery}>
							<div>
								<h2 className="text-xl font-semibold">取件</h2>
								<p className="mt-1 text-sm text-[#64716a]">输入取件码查看文件状态</p>
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
								<span>⌕</span>
								{busy === "lookup" ? "查询中" : "查询文件"}
							</button>

							{delivery && (
								<div className="delivery-box">
									<div className="flex items-start justify-between gap-4">
										<div className="min-w-0">
											<p className="truncate font-semibold">{delivery.fileName}</p>
											<p className="mt-1 text-sm text-[#64716a]">{formatBytes(delivery.size)}</p>
										</div>
										<span className="status-pill">{statusText[delivery.status]}</span>
									</div>
									<div className="grid grid-cols-2 gap-3 text-sm">
										<Mini label="剩余" value={`${delivery.remainingDownloads}/${delivery.maxDownloads}`} />
										<Mini label="过期" value={formatTime(delivery.expiresAt)} />
									</div>
									<a
										className="primary-button justify-center"
										aria-disabled={delivery.status !== "available"}
										href={
											delivery.status === "available"
												? `/api/deliveries/${encodeURIComponent(pickupCode.trim())}/download`
												: undefined
										}
									>
										<span>↓</span>
										下载文件
									</a>
								</div>
							)}
						</form>

						<form className="panel flex flex-col gap-5" onSubmit={revokeDelivery}>
							<div>
								<h2 className="text-xl font-semibold">管理</h2>
								<p className="mt-1 text-sm text-[#64716a]">使用管理码撤回文件</p>
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
								<span>×</span>
								{busy === "revoke" ? "撤回中" : "撤回文件"}
							</button>
						</form>
					</div>
				</div>

				{notice && <p className="notice">{notice}</p>}
			</section>
		</main>
	);
}

function Metric({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-md border border-[#d8ded0] bg-white/70 px-3 py-2">
			<p className="text-xs text-[#64716a]">{label}</p>
			<p className="font-semibold">{value}</p>
		</div>
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
		<div className="rounded-md bg-[#f3f5ec] px-3 py-2">
			<p className="text-xs text-[#64716a]">{label}</p>
			<p className="font-medium">{value}</p>
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
