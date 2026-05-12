"use client";

import {
	type FormEvent,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { GooeyToaster, gooeyToast } from "goey-toast";
import { AdminPanel } from "./components/admin-panel";
import { readApiJson } from "./components/api-json";
import { formatBytes, normalizePickupCode, PICKUP_CODE_LENGTH } from "./components/locker-format";
import type {
	ApiError,
	Delivery,
	DeliveryKind,
	DeliveryLookupResult,
	SiteStats,
	TextPreview,
	UploadResult,
} from "./components/locker-types";
import { PickupPanel } from "./components/pickup-panel";
import { StatsLockup } from "./components/stats-lockup";
import { UploadPanel } from "./components/upload-panel";

const MAX_TEXT_SIZE = 256 * 1024;
const TEXT_FILE_NAME = "寄存文本.txt";
const textFilePattern = /\.(txt|md|csv|json|log|xml|yml|yaml)$/i;

function isTextUploadFile(nextFile: File) {
	return nextFile.type.startsWith("text/") || nextFile.type === "application/json" || textFilePattern.test(nextFile.name);
}

type LockerAppProps = {
	demoMode?: boolean;
};

export default function LockerApp({ demoMode = false }: LockerAppProps) {
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
	const [pickupAccessToken, setPickupAccessToken] = useState("");
	const [powStatus, setPowStatus] = useState("");
	const [stats, setStats] = useState<SiteStats | null>(null);
	const [busy, setBusy] = useState<"upload" | "lookup" | "download" | "revoke" | null>(null);
	const capProgressRef = useRef<(progress: number) => void>(() => undefined);

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

	async function importTextFile(nextFile: File | null) {
		if (!nextFile) {
			return;
		}

		if (demoMode) {
			notify("演示模式下不能寄存文本。", "warning");
			return;
		}

		gooeyToast.dismiss();
		setUploadResult(null);
		setTextPreview(null);
		setPickupAccessToken("");

		if (!isTextUploadFile(nextFile)) {
			notify("请拖入文本文件。", "warning");
			return;
		}

		if (nextFile.size > MAX_TEXT_SIZE) {
			notify("文本不能超过 256 KB。", "warning");
			return;
		}

		try {
			const nextText = await nextFile.text();
			if (!nextText.trim()) {
				notify("文本文件是空的。", "warning");
				return;
			}

			setTextContent(nextText);
			notify("文本文件已载入。", "success");
		} catch (error) {
			notify(error instanceof Error ? error.message : "文本文件读取失败。", "error");
		}
	}

	async function uploadDelivery(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		gooeyToast.dismiss();
		setUploadResult(null);
		setTextPreview(null);

		if (demoMode) {
			notify("演示模式下不能上传或寄存内容。", "warning");
			return;
		}

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
		setPickupAccessToken("");
		gooeyToast.dismiss();

		if (code.length !== PICKUP_CODE_LENGTH) {
			notify("请输入 6 位取件码。", "warning");
			return;
		}

		setBusy("lookup");
		setPowStatus("正在完成人机校验...");
		try {
			const capToken = await solvePowToken((progress) => {
				setPowStatus(`正在完成人机校验 ${Math.round(progress)}%`);
			});
			setPowStatus("正在查询取件码...");
			const response = await fetch(`/api/deliveries/${encodeURIComponent(code)}`, {
				headers: {
					"x-cap-token": capToken,
				},
			});
			const data = await readApiJson<ApiError & DeliveryLookupResult>(response, "查询失败。");
			if (!response.ok) {
				throw new Error(data.error ?? "没有找到这个文件。");
			}

			setDelivery(data.delivery);
			setPickupAccessToken(data.pickupAccessToken);
			if (data.delivery.kind === "text" && data.delivery.status === "available") {
				await previewTextDelivery(code, data.pickupAccessToken);
			}
			void loadStats();
		} catch (error) {
			setDelivery(null);
			setTextPreview(null);
			setPickupAccessToken("");
			notify(error instanceof Error ? error.message : "查询失败。", "error");
		} finally {
			setPowStatus("");
			setBusy(null);
		}
	}

	async function previewTextDelivery(code: string, accessToken: string) {
		const response = await fetch(`/api/deliveries/${encodeURIComponent(code)}/preview`, {
			headers: {
				"x-pickup-access-token": accessToken,
			},
		});
		const data = await readApiJson<ApiError & TextPreview>(response, "文本预览失败。");
		if (!response.ok) {
			throw new Error(data.error ?? "文本预览失败。");
		}

		setTextPreview({
			text: data.text,
			remainingDownloads: data.remainingDownloads,
		});
	}

	async function solvePowToken(onProgress: (progress: number) => void) {
		capProgressRef.current = onProgress;
		const { default: Cap } = await import("cap-widget");
		const cap = new Cap({
			apiEndpoint: "/api/pow/",
			"data-cap-worker-count": "1",
			"data-cap-i18n-initial-state": "人机校验",
			"data-cap-i18n-verifying-label": "正在校验...",
			"data-cap-i18n-solved-label": "校验通过",
			"data-cap-i18n-error-label": "校验失败",
		});
		const handleProgress = (event: CustomEvent<{ progress: number }>) => capProgressRef.current(event.detail.progress);
		cap.addEventListener("progress", handleProgress as EventListener);

		try {
			const result = await cap.solve();
			if (!result.success || !result.token) {
				throw new Error("人机校验失败，请重试。");
			}

			return result.token;
		} finally {
			cap.reset();
			cap.widget.remove();
		}
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

	async function downloadDelivery() {
		const code = normalizePickupCode(pickupCode);
		if (!delivery || !pickupAccessToken || code.length !== PICKUP_CODE_LENGTH) {
			notify("请先查询有效取件码。", "warning");
			return;
		}

		setBusy("download");
		gooeyToast.dismiss();
		try {
			const response = await fetch(`/api/deliveries/${encodeURIComponent(code)}/download`, {
				headers: {
					"x-pickup-access-token": pickupAccessToken,
				},
			});
			if (!response.ok) {
				const data = await readApiJson<ApiError>(response, "下载失败。");
				throw new Error(data.error ?? "下载失败。");
			}

			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = getDownloadFileName(response.headers.get("content-disposition"), delivery.fileName);
			document.body.appendChild(link);
			link.click();
			link.remove();
			window.setTimeout(() => URL.revokeObjectURL(url), 1000);
			void loadStats();
		} catch (error) {
			notify(error instanceof Error ? error.message : "下载失败。", "error");
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
							demoMode={demoMode}
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
							onTextFileChange={importTextFile}
						/>
						<PickupPanel
							busy={busy === "lookup"}
							delivery={delivery}
							downloading={busy === "download"}
							pickupCode={pickupCode}
							pickupAccessToken={pickupAccessToken}
							powStatus={powStatus}
							textPreview={textPreview}
							onCopy={copy}
							onDownload={downloadDelivery}
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

function getDownloadFileName(contentDisposition: string | null, fallback: string) {
	const utf8Match = contentDisposition?.match(/filename\*=UTF-8''([^;]+)/i);
	if (utf8Match?.[1]) {
		try {
			return decodeURIComponent(utf8Match[1]);
		} catch {
			return fallback;
		}
	}

	const asciiMatch = contentDisposition?.match(/filename="([^"]+)"/i);
	return asciiMatch?.[1] || fallback;
}
