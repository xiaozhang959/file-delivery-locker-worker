"use client";

import {
	type FormEvent,
	useEffect,
	useMemo,
	useState,
} from "react";
import { GooeyToaster, gooeyToast } from "goey-toast";
import { AdminPanel } from "./components/admin-panel";
import { readApiJson } from "./components/api-json";
import { formatBytes, normalizePickupCode, PICKUP_CODE_LENGTH } from "./components/locker-format";
import type { ApiError, Delivery, DeliveryKind, SiteStats, TextPreview, UploadResult } from "./components/locker-types";
import { PickupPanel } from "./components/pickup-panel";
import { StatsLockup } from "./components/stats-lockup";
import { UploadPanel } from "./components/upload-panel";

const MAX_TEXT_SIZE = 256 * 1024;
const TEXT_FILE_NAME = "寄存文本.txt";

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
	const [stats, setStats] = useState<SiteStats | null>(null);
	const [busy, setBusy] = useState<"upload" | "lookup" | "revoke" | null>(null);

	const selectedFileSize = useMemo(() => (file ? formatBytes(file.size) : "未选择"), [file]);
	const textSize = useMemo(() => formatBytes(new TextEncoder().encode(textContent).length), [textContent]);
	const uploadBadge = deliveryMode === "text" ? textSize : selectedFileSize;

	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const code = params.get("pickupCode");
		if (code) {
			const frame = window.requestAnimationFrame(() => setPickupCode(normalizePickupCode(code)));
			return () => window.cancelAnimationFrame(frame);
		}
	}, []);

	useEffect(() => {
		void loadStats();
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
			const data = await readApiJson<ApiError & UploadResult>(response, "上传失败。");
			if (!response.ok) {
				throw new Error(data.error ?? "上传失败。");
			}

			setUploadResult(data);
			setPickupCode(data.pickupCode);
			setManageCode(data.manageCode);
			void loadStats();
			notify(deliveryMode === "text" ? "文本已入柜。" : "文件已入柜。", "success");
		} catch (error) {
			notify(error instanceof Error ? error.message : "上传失败。", "error");
		} finally {
			setBusy(null);
		}
	}

	async function lookupDelivery(event?: FormEvent<HTMLFormElement>) {
		event?.preventDefault();
		const code = normalizePickupCode(pickupCode);
		setPickupCode(code);
		setDelivery(null);
		setTextPreview(null);
		gooeyToast.dismiss();

		if (code.length !== PICKUP_CODE_LENGTH) {
			notify("请输入 6 位取件码。", "warning");
			return;
		}

		setBusy("lookup");
		try {
			const response = await fetch(`/api/deliveries/${encodeURIComponent(code)}`);
			const data = await readApiJson<ApiError & { delivery: Delivery }>(response, "查询失败。");
			if (!response.ok) {
				throw new Error(data.error ?? "没有找到这个文件。");
			}

			setDelivery(data.delivery);
			if (data.delivery.kind === "text" && data.delivery.status === "available") {
				await previewTextDelivery(code);
			}
			void loadStats();
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
		const data = await readApiJson<ApiError & TextPreview>(response, "文本预览失败。");
		if (!response.ok) {
			throw new Error(data.error ?? "文本预览失败。");
		}

		setTextPreview({
			text: data.text,
			remainingDownloads: data.remainingDownloads,
		});
	}

	async function loadStats() {
		try {
			const response = await fetch("/api/stats");
			const data = await readApiJson<ApiError & SiteStats>(response, "统计读取失败。");
			if (!response.ok) {
				throw new Error(data.error ?? "统计读取失败。");
			}

			setStats({
				uploadCount: data.uploadCount,
				downloadCount: data.downloadCount,
			});
		} catch (error) {
			console.warn(error instanceof Error ? error.message : "统计读取失败。");
		}
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
			const data = await readApiJson<ApiError>(response, "撤回失败。");
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
		<main className="app-shell min-h-screen">
			<section className="mx-auto flex min-h-screen w-full max-w-[1200px] flex-col gap-10 px-5 pt-6 pb-16 sm:px-8 min-[960px]:px-10 max-sm:gap-8 max-sm:pt-4">
				<StatsLockup stats={stats} />
				<div className="grid flex-1 gap-6">
					<div className="grid gap-6 min-[960px]:grid-cols-[minmax(0,1.08fr)_minmax(340px,0.92fr)] min-[960px]:items-start">
						<UploadPanel
							busy={busy === "upload"}
							deliveryMode={deliveryMode}
							expiresInHours={expiresInHours}
							maxDownloadsInput={maxDownloadsInput}
							selectedFileName={file?.name ?? null}
							textContent={textContent}
							uploadBadge={uploadBadge}
							uploadResult={uploadResult}
							onCopy={copy}
							onDeliveryModeChange={setDeliveryMode}
							onExpiresInHoursChange={setExpiresInHours}
							onFileChange={setFile}
							onMaxDownloadsInputChange={setMaxDownloadsInput}
							onSubmit={uploadDelivery}
							onTextContentChange={setTextContent}
						/>
						<PickupPanel
							busy={busy === "lookup"}
							delivery={delivery}
							pickupCode={pickupCode}
							textPreview={textPreview}
							onCopy={copy}
							onDownloadStarted={() => void loadStats()}
							onPickupCodeChange={setPickupCode}
							onSubmit={lookupDelivery}
						/>
					</div>

					<AdminPanel
						busy={busy === "revoke"}
						manageCode={manageCode}
						onManageCodeChange={setManageCode}
						onSubmit={revokeDelivery}
					/>
				</div>

				<GooeyToaster closeButton="top-right" position="bottom-right" preset="subtle" showProgress visibleToasts={3} />
			</section>
		</main>
	);
}
