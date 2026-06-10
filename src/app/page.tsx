import { cookies } from "next/headers";
import { getCloudflareDb, getDemoMode, getSiteAuthSession, getSitePassword, getUploadSettings, SITE_AUTH_COOKIE } from "@/lib/locker";
import LockerApp from "./locker-app";
import PasswordGate from "./password-gate";

export default async function Home() {
	const demoMode = await getDemoMode();
	const uploadSettings = await getHomeUploadSettings();
	if (demoMode) {
		return <LockerApp customPickupCodeEnabled={uploadSettings.customPickupCodeEnabled} demoMode={demoMode} />;
	}

	const sitePassword = await getSitePassword();
	const cookieStore = await cookies();
	const token = cookieStore.get(SITE_AUTH_COOKIE)?.value;
	const session = await getSiteAuthSession(sitePassword, token);

	if (!session.valid) {
		return <PasswordGate />;
	}

	return <LockerApp csrfToken={session.csrfToken} customPickupCodeEnabled={uploadSettings.customPickupCodeEnabled} demoMode={demoMode} />;
}

async function getHomeUploadSettings() {
	const db = await getCloudflareDb();
	return db ? getUploadSettings(db) : { customPickupCodeEnabled: true };
}
