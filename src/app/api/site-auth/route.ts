import {
	cleanupAuthArtifacts,
	clearAuthFailures,
	createSiteAuthSession,
	getAuthLockStatus,
	getCloudflareBindings,
	getDemoMode,
	getSitePassword,
	isSecretEqual,
	json,
	recordAuthFailure,
	serializeSiteAuthCookies,
} from "@/lib/locker";

export async function POST(request: Request) {
	if (await getDemoMode()) {
		return json({ locked: false, demoMode: true });
	}

	const { db, ctx } = await getCloudflareBindings();
	if (!db) {
		return json({ error: "Cloudflare bindings are not available." }, 500);
	}

	const sitePassword = await getSitePassword();
	if (!sitePassword) {
		return json({ locked: false });
	}

	const now = Date.now();
	const lock = await getAuthLockStatus(db, "site", request, now);
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
	if (!(await isSecretEqual(password, sitePassword))) {
		const failure = await recordAuthFailure(db, "site", request, now);
		return json(
			{
				error: failure.lockedUntil ? `密码不正确，已临时锁定 ${failure.retryAfterSeconds} 秒。` : "密码不正确。",
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

	await clearAuthFailures(db, "site", request);
	const session = await createSiteAuthSession(db, sitePassword, request, now);
	const headers = new Headers();
	for (const cookie of serializeSiteAuthCookies(session, request.url)) {
		headers.append("set-cookie", cookie);
	}
	ctx.waitUntil(cleanupAuthArtifacts(db, now).catch((error) => console.warn(error)));

	return json(
		{ locked: true },
		{
			headers,
		},
	);
}
