"use client";

import { type FormEvent, useState } from "react";

type AuthResponse = {
	error?: string;
};

export default function PasswordGate() {
	const [password, setPassword] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);

	async function enterSite(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setError("");
		setBusy(true);

		try {
			const response = await fetch("/api/site-auth", {
				method: "POST",
				headers: {
					"content-type": "application/json",
				},
				body: JSON.stringify({ password }),
			});
			const data = (await response.json()) as AuthResponse;
			if (!response.ok) {
				throw new Error(data.error ?? "密码不正确。");
			}

			window.location.reload();
		} catch (authError) {
			setError(authError instanceof Error ? authError.message : "密码不正确。");
		} finally {
			setBusy(false);
		}
	}

	return (
		<main className="app-shell">
			<section className="page-shell auth-shell">
				<form className="panel panel-feature auth-panel" onSubmit={enterSite}>
					<h2>访问密码</h2>
					<label className="field">
						<span>密码</span>
						<input
							autoComplete="current-password"
							autoFocus
							type="password"
							value={password}
							onChange={(event) => setPassword(event.target.value)}
						/>
					</label>
					{error ? <p className="auth-error">{error}</p> : null}
					<button className="primary-button" disabled={busy} type="submit">
						{busy ? "验证中" : "进入网站"}
					</button>
				</form>
			</section>
		</main>
	);
}
