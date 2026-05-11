"use client";

import { type FormEvent, useState } from "react";
import { readApiJson } from "../components/api-json";

type AuthResponse = {
	error?: string;
};

export default function AdminLogin() {
	const [password, setPassword] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);

	async function enterAdmin(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setError("");
		setBusy(true);

		try {
			const response = await fetch("/api/admin/auth", {
				method: "POST",
				headers: {
					"content-type": "application/json",
				},
				body: JSON.stringify({ password }),
			});
			const data = await readApiJson<AuthResponse>(response, "后台密码不正确。");
			if (!response.ok) {
				throw new Error(data.error ?? "后台密码不正确。");
			}

			window.location.reload();
		} catch (authError) {
			setError(authError instanceof Error ? authError.message : "后台密码不正确。");
		} finally {
			setBusy(false);
		}
	}

	return (
		<main className="app-shell min-h-screen">
			<section className="mx-auto flex min-h-screen w-full max-w-[1200px] flex-col items-center justify-center gap-10 px-5 pt-6 pb-16 sm:px-8 min-[960px]:px-10">
				<form className="panel panel-feature flex w-[min(100%,420px)] flex-col gap-5" onSubmit={enterAdmin}>
					<h2>管理后台</h2>
					<label className="field flex flex-col gap-2">
						<span>后台密码</span>
						<input
							className="h-[42px] w-full"
							autoComplete="current-password"
							autoFocus
							type="password"
							value={password}
							onChange={(event) => setPassword(event.target.value)}
						/>
					</label>
					{error ? <p className="auth-error">{error}</p> : null}
					<button
						className="primary-button inline-flex min-h-10 items-center justify-center gap-[9px] rounded-lg px-5 text-sm leading-none font-medium no-underline"
						disabled={busy}
						type="submit"
					>
						{busy ? "验证中" : "进入后台"}
					</button>
				</form>
			</section>
		</main>
	);
}
