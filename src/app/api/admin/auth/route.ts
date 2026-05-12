import {
	cleanupAuthArtifacts,
	clearAuthFailures,
	createAdminAuthSession,
	getAdminPassword,
	getAuthLockStatus,
	getCloudflareBindings,
	isSecretEqual,
	json,
	recordAuthFailure,
	serializeAdminAuthCookies,
} from "@/lib/locker";

export async function POST(request: Request) {
	const { db, ctx } = await getCloudflareBindings();
	if (!db) {
		return json({ error: "Cloudflare bindings are not available." }, 500);
	}

	const adminPassword = await getAdminPassword();
	if (!adminPassword) {
		return json({ error: "后台密码未配置。" }, 503);
	}

	const now = Date.now();
	const lock = await getAuthLockStatus(db, "admin", request, now);
	if (lock.locked) {
		return json(
			{ error: `尝试次数过多，请 ${lock.retryAfterSeconds} 秒后再试。`, retryAfterSeconds: lock.retryAfterSeconds },
			{
				status: 429,
				headers: {
					"retry-after": String(lock.retryAfterSeconds),
				},
			},
		);
	}

	const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
	const password = typeof body?.password === "string" ? body.password : "";
	if (!(await isSecretEqual(password, adminPassword))) {
		const failure = await recordAuthFailure(db, "admin", request, now);
		return json(
			{
				error: failure.lockedUntil ? `后台密码不正确，已临时锁定 ${failure.retryAfterSeconds} 秒。` : "后台密码不正确。",
				retryAfterSeconds: failure.retryAfterSeconds,
			},
			failure.lockedUntil
				? {
						status: 429,
						headers: {
							"retry-after": String(failure.retryAfterSeconds),
						},
					}
				: 401,
		);
	}

	await clearAuthFailures(db, "admin", request);
	const session = await createAdminAuthSession(db, adminPassword, request, now);
	const headers = new Headers();
	for (const cookie of serializeAdminAuthCookies(session, request.url)) {
		headers.append("set-cookie", cookie);
	}
	ctx.waitUntil(cleanupAuthArtifacts(db, now).catch((error) => console.warn(error)));

	return json(
		{ ok: true },
		{
			headers,
		},
	);
}
