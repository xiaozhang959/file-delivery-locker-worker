import { cookies } from "next/headers";
import { ADMIN_AUTH_COOKIE, getAdminAuthSession, getAdminPassword, getDemoMode } from "@/lib/locker";
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
		return (
			<main className="app-shell min-h-screen">
				<section className="mx-auto flex min-h-screen w-full max-w-[1200px] flex-col items-center justify-center px-5 py-16 sm:px-8">
					<div className="panel panel-feature flex w-[min(100%,460px)] flex-col gap-3">
						<h2>管理后台未启用</h2>
						<p className="panel-copy">请先配置 ADMIN_PASSWORD。</p>
					</div>
				</section>
			</main>
		);
	}

	const cookieStore = await cookies();
	const token = cookieStore.get(ADMIN_AUTH_COOKIE)?.value;
	const session = await getAdminAuthSession(adminPassword, token);

	if (!session.valid) {
		return <AdminLogin />;
	}

	return <AdminApp csrfToken={session.csrfToken ?? ""} demoMode={demoMode} />;
}
