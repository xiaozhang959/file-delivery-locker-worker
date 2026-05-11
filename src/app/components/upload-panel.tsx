"use client";

import { useState } from "react";
import type { DragEvent, FormEvent } from "react";
import { CodeBlock } from "./code-block";
import type { DeliveryKind, UploadResult } from "./locker-types";

const expiryOptions = [
	{ label: "1 小时", value: 1 },
	{ label: "24 小时", value: 24 },
	{ label: "7 天", value: 168 },
];

type UploadPanelProps = {
	busy: boolean;
	demoMode: boolean;
	deliveryMode: DeliveryKind;
	expiresInHours: number;
	maxDownloadsInput: string;
	selectedFileName: string | null;
	textContent: string;
	uploadBadge: string;
	uploadResult: UploadResult | null;
	onCopy: (value: string) => void;
	onDeliveryModeChange: (mode: DeliveryKind) => void;
	onExpiresInHoursChange: (value: number) => void;
	onFileChange: (file: File | null) => void;
	onMaxDownloadsInputChange: (value: string) => void;
	onSubmit: (event: FormEvent<HTMLFormElement>) => void;
	onTextContentChange: (value: string) => void;
	onTextFileChange: (file: File | null) => void;
};

export function UploadPanel({
	busy,
	demoMode,
	deliveryMode,
	expiresInHours,
	maxDownloadsInput,
	selectedFileName,
	textContent,
	uploadBadge,
	uploadResult,
	onCopy,
	onDeliveryModeChange,
	onExpiresInHoursChange,
	onFileChange,
	onMaxDownloadsInputChange,
	onSubmit,
	onTextContentChange,
	onTextFileChange,
}: UploadPanelProps) {
	const [isDragActive, setIsDragActive] = useState(false);

	function hasDroppableData(event: DragEvent<HTMLElement>) {
		if (demoMode) {
			return false;
		}

		return (
			event.dataTransfer.types.includes("Files") ||
			(deliveryMode === "text" && event.dataTransfer.types.includes("text/plain"))
		);
	}

	function handlePanelDragOver(event: DragEvent<HTMLFormElement>) {
		if (!hasDroppableData(event)) {
			return;
		}

		event.preventDefault();
		event.dataTransfer.dropEffect = "copy";
		setIsDragActive(true);
	}

	function handlePanelDragLeave(event: DragEvent<HTMLFormElement>) {
		if (event.currentTarget === event.target || !event.currentTarget.contains(event.relatedTarget as Node | null)) {
			setIsDragActive(false);
		}
	}

	function handlePanelDrop(event: DragEvent<HTMLFormElement>) {
		if (!hasDroppableData(event)) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		setIsDragActive(false);

		const droppedFile = event.dataTransfer.files.item(0);
		if (droppedFile) {
			if (deliveryMode === "text") {
				onTextFileChange(droppedFile);
				return;
			}

			onFileChange(droppedFile);
			return;
		}

		const droppedText = event.dataTransfer.getData("text/plain");
		if (deliveryMode === "text" && droppedText) {
			onTextContentChange(droppedText);
		}
	}

	return (
		<form
			className={`panel panel-feature flex flex-col gap-6 ${isDragActive ? "is-drag-active" : ""}`}
			onDragLeave={handlePanelDragLeave}
			onDragOver={handlePanelDragOver}
			onDrop={handlePanelDrop}
			onSubmit={onSubmit}
		>
			<div className="flex items-center justify-between gap-4">
				<div>
					<h2>寄件</h2>
					<p className="panel-copy">
						{demoMode
							? "演示模式下只能查看和取件，不能放入新内容"
							: deliveryMode === "text"
								? "输入一段文本放入快递柜"
								: selectedFileName ?? "选择一个文件放入快递柜"}
					</p>
				</div>
				<span className="badge-coral inline-flex w-fit items-center">{uploadBadge}</span>
			</div>

			<div className="w-full">
				<div className="mode-switch-row inline-flex min-h-11 w-fit items-center justify-center self-center">
					<span className={deliveryMode === "file" ? "active" : undefined}>上传文件</span>
					<button
						type="button"
						className="mode-switch inline-flex h-7 w-[54px] items-center p-0 mx-2"
						role="switch"
						aria-checked={deliveryMode === "text"}
						aria-label="切换寄件类型"
						disabled={demoMode}
						onClick={() => onDeliveryModeChange(deliveryMode === "text" ? "file" : "text")}
					>
						<span className="switch-track relative block h-7 w-[54px] rounded-full" aria-hidden="true">
							<span className="switch-thumb absolute top-1 left-1 h-5 w-5 rounded-full" />
						</span>
					</button>
					<span className={deliveryMode === "text" ? "active" : undefined}>寄存文本</span>
				</div>
			</div>

			{deliveryMode === "text" ? (
				<div className={`text-dropzone field flex flex-col gap-3 ${isDragActive ? "is-drag-active" : ""}`}>
					<textarea
						className="h-[230px] w-full resize-none"
						disabled={demoMode}
						value={textContent}
						onChange={(event) => onTextContentChange(event.target.value)}
						placeholder="输入要寄存的纯文本"
					/>
					<div className="flex flex-wrap items-center justify-between gap-3">
						<span className="text-dropzone-hint">拖入文本文件</span>
						<label className="secondary-button inline-flex min-h-9 cursor-pointer items-center justify-center rounded-lg px-4 text-sm font-medium">
							<input
								accept=".txt,.md,.csv,.json,.log,.xml,.yml,.yaml,text/*,application/json"
								className="sr-only"
								disabled={demoMode}
								type="file"
								onChange={(event) => {
									onTextFileChange(event.target.files?.[0] ?? null);
									event.currentTarget.value = "";
								}}
							/>
							选择文本文件
						</label>
					</div>
				</div>
			) : (
				<label className={`dropzone flex min-h-[230px] flex-col items-center justify-center gap-2.5 ${demoMode ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}>
					<input
						className="sr-only"
						disabled={demoMode}
						type="file"
						onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
					/>
					<span className="text-4xl">+</span>
					<span className="font-medium">{demoMode ? "演示模式不可上传" : "选择文件"}</span>
				</label>
			)}

			<div className="grid gap-4 sm:grid-cols-2">
				<label className="field flex flex-col gap-2">
					<span>保存期限</span>
					<select
						className="h-[42px] w-full"
						disabled={demoMode}
						value={expiresInHours}
						onChange={(event) => onExpiresInHoursChange(Number(event.target.value))}
					>
						{expiryOptions.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</label>
				<label className="field flex flex-col gap-2">
					<span>下载次数</span>
					<input
						className="h-[42px] w-full"
						disabled={demoMode}
						max={10}
						min={1}
						step={1}
						type="number"
						value={maxDownloadsInput}
						onChange={(event) => onMaxDownloadsInputChange(event.target.value)}
					/>
				</label>
			</div>

			<button
				className="primary-button inline-flex min-h-10 items-center justify-center gap-[9px] rounded-lg px-5 text-sm leading-none font-medium no-underline"
				disabled={busy || demoMode}
				type="submit"
			>
				<span aria-hidden="true">↑</span>
				{demoMode ? "演示模式只读" : busy ? "上传中" : "放入快递柜"}
			</button>

			{uploadResult && (
				<div className="grid grid-cols-1 gap-3 border-t border-[rgba(20,20,19,0.08)] pt-[18px] sm:grid-cols-2">
					<CodeBlock label="取件码" value={uploadResult.pickupCode} onCopy={onCopy} />
					<CodeBlock label="管理码" value={uploadResult.manageCode} onCopy={onCopy} />
					<CodeBlock label="取件链接" value={uploadResult.pickupUrl} onCopy={onCopy} wide />
				</div>
			)}
		</form>
	);
}
