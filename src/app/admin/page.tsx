import { cookies } from "next/headers";
import { ADMIN_AUTH_COOKIE, getAdminAuthSession, getAdminPassword, getDemoMode } from "@/lib/locker";
import AdminDisabled from "./admin-disabled";
import AdminApp from "./admin-app";
import AdminLogin from "./admin-login";

export const metadata = {
	title: "管理后台 - 文件快递柜",
};

export const dynamic = "force-dynamic";

export default async function AdminPage() {
	const demoMode = await getDemoMode();
	const adminPassword = await getAdminPassword();
	if (!adminPassword) {
		return <AdminDisabled />;
	}

	const cookieStore = await cookies();
	const token = cookieStore.get(ADMIN_AUTH_COOKIE)?.value;
	const session = await getAdminAuthSession(adminPassword, token);

	if (!session.valid) {
		return <AdminLogin />;
	}

	return <AdminApp csrfToken={session.csrfToken ?? ""} demoMode={demoMode} />;
}
