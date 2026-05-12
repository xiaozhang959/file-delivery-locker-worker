import { cookies } from "next/headers";
import { getDemoMode, getSiteAuthSession, getSitePassword, SITE_AUTH_COOKIE } from "@/lib/locker";
import LockerApp from "./locker-app";
import PasswordGate from "./password-gate";

export default async function Home() {
	const demoMode = await getDemoMode();
	if (demoMode) {
		return <LockerApp demoMode={demoMode} />;
	}

	const sitePassword = await getSitePassword();
	const cookieStore = await cookies();
	const token = cookieStore.get(SITE_AUTH_COOKIE)?.value;
	const session = await getSiteAuthSession(sitePassword, token);

	if (!session.valid) {
		return <PasswordGate />;
	}

	return <LockerApp csrfToken={session.csrfToken} demoMode={demoMode} />;
}
