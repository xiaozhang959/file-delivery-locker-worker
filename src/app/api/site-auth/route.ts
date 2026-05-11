import { createSiteAuthToken, getDemoMode, getSitePassword, json, serializeSiteAuthCookie } from "@/lib/locker";

export async function POST(request: Request) {
	if (await getDemoMode()) {
		return json({ locked: false, demoMode: true });
	}

	const sitePassword = await getSitePassword();
	if (!sitePassword) {
		return json({ locked: false });
	}

	const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
	const password = typeof body?.password === "string" ? body.password : "";
	if (password !== sitePassword) {
		return json({ error: "密码不正确。" }, 401);
	}

	const token = await createSiteAuthToken(sitePassword);
	return json(
		{ locked: true },
		{
			headers: {
				"set-cookie": serializeSiteAuthCookie(token, request.url),
			},
		},
	);
}
