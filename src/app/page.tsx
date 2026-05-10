import { cookies } from "next/headers";
import { getSitePassword, isSiteAuthTokenValid, SITE_AUTH_COOKIE } from "@/lib/locker";
import LockerApp from "./locker-app";
import PasswordGate from "./password-gate";

export default async function Home() {
	const sitePassword = await getSitePassword();
	const cookieStore = await cookies();
	const token = cookieStore.get(SITE_AUTH_COOKIE)?.value;
	const authorized = await isSiteAuthTokenValid(sitePassword, token);

	if (!authorized) {
		return <PasswordGate />;
	}

	return <LockerApp />;
}
