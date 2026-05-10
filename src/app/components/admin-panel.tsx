"use client";

import type { FormEvent } from "react";

type AdminPanelProps = {
	busy: boolean;
	manageCode: string;
	onManageCodeChange: (value: string) => void;
	onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function AdminPanel({ busy, manageCode, onManageCodeChange, onSubmit }: AdminPanelProps) {
	return (
		<form className="panel admin-panel flex flex-col gap-5 w-full" onSubmit={onSubmit}>
			<div>
				<h2>管理</h2>
				<p className="panel-copy">使用管理码撤回文件</p>
			</div>
			<label className="field flex flex-col gap-2">
				<span>管理码</span>
				<input
					className="h-[42px] w-full"
					autoCapitalize="characters"
					value={manageCode}
					onChange={(event) => onManageCodeChange(event.target.value.toUpperCase())}
					placeholder="创建后显示一次"
				/>
			</label>
			<button
				className="danger-button inline-flex min-h-10 items-center justify-center gap-[9px] rounded-lg px-5 text-sm leading-none font-medium no-underline"
				disabled={busy}
				type="submit"
			>
				<span aria-hidden="true">×</span>
				{busy ? "撤回中" : "撤回文件"}
			</button>
		</form>
	);
}
