import type { Metadata } from "next";
import { LanguageProvider } from "./i18n";
import { SiteFooter } from "./components/site-footer";
import "./globals.css";
import "./styles/layout.css";
import "./styles/panels.css";
import "./styles/stats.css";
import "./styles/forms.css";
import "./styles/buttons.css";
import "./styles/delivery.css";
import "./goey-toast.css";

export const metadata: Metadata = {
	title: "文件快递柜",
	description: "基于对象存储和 D1 的匿名文件中转柜",
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="zh-CN">
			<head>
				<link rel="icon" href="/favicon.ico" type="image/svg+xml"></link>
			</head>
			<body>
				<LanguageProvider>
					{children}
					<SiteFooter />
				</LanguageProvider>
			</body>
		</html>
	);
}
