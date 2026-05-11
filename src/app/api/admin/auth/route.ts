import { createAdminAuthToken, getAdminPassword, getDemoMode, json, serializeAdminAuthCookie } from "@/lib/locker";

export async function POST(request: Request) {
	if (await getDemoMode()) {
		return json({ ok: true, demoMode: true });
	}

	const adminPassword = await getAdminPassword();
	if (!adminPassword) {
		return json({ error: "后台密码未配置。" }, 503);
	}

	const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
	const password = typeof body?.password === "string" ? body.password : "";
	if (password !== adminPassword) {
		return json({ error: "后台密码不正确。" }, 401);
	}

	const token = await createAdminAuthToken(adminPassword);
	return json(
		{ ok: true },
		{
			headers: {
				"set-cookie": serializeAdminAuthCookie(token, request.url),
			},
		},
	);
}
