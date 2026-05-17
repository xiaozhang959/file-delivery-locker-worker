"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GooeyToaster, gooeyToast } from "goey-toast";
import { readApiJson } from "../../components/api-json";
import { formatBytes, formatTime } from "../../components/locker-format";
import type { ApiError, Delivery, DeliveryLookupResult, TextPreview } from "../../components/locker-types";
import { Mini } from "../../components/mini";
import { useI18n } from "../../i18n";

type GuestDownloadPageProps = {
	guestToken: string;
};

export default function GuestDownloadPage({ guestToken }: GuestDownloadPageProps) {
	const { locale, t } = useI18n();
	const [delivery, setDelivery] = useState<Delivery | null>(null);
	const [loadError, setLoadError] = useState("");
	const [loading, setLoading] = useState(true);
	const [textPreview, setTextPreview] = useState<TextPreview | null>(null);
	const [busy, setBusy] = useState(false);
	const [powStatus, setPowStatus] = useState("");
	const capProgressRef = useRef<(progress: number) => void>(() => undefined);
	const statusText: Record<Delivery["status"], string> = {
		available: t("status.available"),
		deleted: t("status.deleted"),
		depleted: t("status.depleted"),
		expired: t("status.expired"),
	};

	const loadGuestDelivery = useCallback(async () => {
		if (!/^[a-fA-F0-9]{64}$/.test(guestToken)) {
			setDelivery(null);
			setLoadError(t("guest.invalidLink"));
			setLoading(false);
			return;
		}

		setLoading(true);
		setLoadError("");
		try {
			const response = await fetch(`/api/deliveries/guest/${encodeURIComponent(guestToken)}`);
			const data = await readApiJson<ApiError & Pick<DeliveryLookupResult, "delivery">>(response, t("message.queryFailed"));
			if (!response.ok) {
				throw new Error(data.error || t("message.queryFailed"));
			}

			setDelivery(data.delivery);
		} catch (error) {
			setDelivery(null);
			setLoadError(error instanceof Error ? error.message : t("message.queryFailed"));
		} finally {
			setLoading(false);
		}
	}, [guestToken, t]);

	useEffect(() => {
		const timer = window.setTimeout(() => {
			void loadGuestDelivery();
		}, 0);
		return () => window.clearTimeout(timer);
	}, [loadGuestDelivery]);

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

	async function solvePowToken(onProgress: (progress: number) => void) {
		capProgressRef.current = onProgress;
		const { default: Cap } = await import("cap-widget");
		const cap = new Cap({
			apiEndpoint: "/api/pow/",
			"data-cap-worker-count": "1",
			"data-cap-i18n-initial-state": t("message.powWidgetInitial"),
			"data-cap-i18n-verifying-label": t("message.powWidgetVerifying"),
			"data-cap-i18n-solved-label": t("message.powWidgetSolved"),
			"data-cap-i18n-error-label": t("message.powWidgetError"),
		});
		const handleProgress = (event: CustomEvent<{ progress: number }>) => capProgressRef.current(event.detail.progress);
		cap.addEventListener("progress", handleProgress as EventListener);

		try {
			const result = await cap.solve();
			if (!result.success || !result.token) {
				throw new Error(t("message.powFailed"));
			}

			return result.token;
		} finally {
			cap.reset();
			cap.widget.remove();
		}
	}

	async function openGuestDelivery() {
		gooeyToast.dismiss();

		if (!/^[a-fA-F0-9]{64}$/.test(guestToken)) {
			notify(t("guest.invalidLink"), "error");
			return;
		}

		setBusy(true);
		setPowStatus(t("message.powInitial"));
		try {
			if (!delivery) {
				throw new Error(t("message.queryFailed"));
			}

			const capToken = await solvePowToken((progress) => {
				setPowStatus(t("message.powProgress", { progress: Math.round(progress) }));
			});

			if (delivery.kind === "text") {
				setPowStatus(t("guest.loadingText"));
				const response = await fetch(`/api/deliveries/guest/${encodeURIComponent(guestToken)}/preview`, {
					headers: {
						"x-cap-token": capToken,
					},
				});
				const data = await readApiJson<ApiError & TextPreview>(response, t("message.previewFailed"));
				if (!response.ok) {
					throw new Error(data.error || t("message.previewFailed"));
				}

				setTextPreview({
					text: data.text,
					remainingDownloads: data.remainingDownloads,
				});
				void loadGuestDelivery();
				notify(t("guest.textReady"), "success");
				return;
			}

			setPowStatus(t("guest.downloading"));
			const response = await fetch(`/api/deliveries/guest/${encodeURIComponent(guestToken)}/download`, {
				headers: {
					"x-cap-token": capToken,
				},
			});
			if (!response.ok) {
				const data = await readApiJson<ApiError>(response, t("message.downloadFailed"));
				throw new Error(data.error || t("message.downloadFailed"));
			}

			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = getDownloadFileName(response.headers.get("content-disposition"), "download");
			document.body.appendChild(link);
			link.click();
			link.remove();
			window.setTimeout(() => URL.revokeObjectURL(url), 1000);
			void loadGuestDelivery();
			notify(t("guest.downloadStarted"), "success");
		} catch (error) {
			notify(error instanceof Error ? error.message : t("message.downloadFailed"), "error");
		} finally {
			setPowStatus("");
			setBusy(false);
		}
	}

	return (
		<main className="app-shell min-h-screen">
			<section className="mx-auto flex min-h-screen w-full max-w-[760px] flex-col items-center justify-center gap-8 px-5 pt-6 pb-16 sm:px-8">
				<div className="panel panel-feature flex w-full flex-col gap-5">
					<div>
						<h2>{t("guest.title")}</h2>
						<p className="panel-copy">{t("guest.copy")}</p>
					</div>
					{loading ? <p className="panel-copy m-0">{t("guest.loading")}</p> : null}
					{loadError ? <p className="auth-error">{loadError}</p> : null}
					{delivery && (
						<div className="delivery-box flex flex-col gap-4">
							<div className="flex items-start justify-between gap-4">
								<div className="min-w-0">
									<p className="truncate font-semibold">{delivery.fileName}</p>
									<p className="panel-copy">{formatBytes(delivery.size)}</p>
								</div>
								<span className="status-pill flex-none rounded-full px-2.5 py-[5px]">{statusText[delivery.status]}</span>
							</div>
							<div className="grid grid-cols-2 gap-3 text-sm">
								<Mini label={t("guest.status")} value={statusText[delivery.status]} />
								<Mini
									label={t("pickup.remaining")}
									value={
										delivery.maxDownloads === 0
											? t("common.unlimited")
											: `${delivery.remainingDownloads ?? 0}/${delivery.maxDownloads}`
									}
								/>
								<Mini label={t("pickup.expires")} value={formatTime(delivery.expiresAt, locale, t("common.forever"))} />
								<Mini label={t("guest.size")} value={formatBytes(delivery.size)} />
							</div>
						</div>
					)}
					{delivery?.kind === "text" && textPreview && (
						<div className="text-preview flex flex-col gap-3">
							<div className="flex items-center justify-between gap-3">
								<span>{t("pickup.preview")}</span>
								<small>
									{textPreview.remainingDownloads === null
										? t("common.unlimited")
										: t("pickup.remainingTimes", { count: textPreview.remainingDownloads })}
								</small>
							</div>
							<pre>{textPreview.text}</pre>
							<button
								className="secondary-button inline-flex min-h-10 items-center justify-center gap-[9px] rounded-lg px-5 text-sm leading-none font-medium no-underline"
								type="button"
								onClick={() => {
									void navigator.clipboard.writeText(textPreview.text);
									notify(t("common.copy"), "success");
								}}
							>
								<span aria-hidden="true">⧉</span>
								{t("pickup.copyText")}
							</button>
						</div>
					)}
					<button
						className="primary-button inline-flex min-h-10 items-center justify-center gap-[9px] rounded-lg px-5 text-sm leading-none font-medium no-underline"
						disabled={busy || loading || !delivery || delivery.status !== "available"}
						type="button"
						onClick={openGuestDelivery}
					>
						<span aria-hidden="true">{delivery?.kind === "text" ? "⌕" : "↓"}</span>
						{busy ? t("guest.verifying") : delivery?.kind === "text" ? t("guest.viewText") : t("guest.download")}
					</button>
					{powStatus && <p className="panel-copy m-0 text-center">{powStatus}</p>}
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
