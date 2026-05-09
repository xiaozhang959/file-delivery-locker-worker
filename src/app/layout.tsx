import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
	title: "文件快递柜",
	description: "基于 Cloudflare R2 和 D1 的匿名文件中转柜",
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="zh-CN">
			<head>
				<link rel="icon" href="/favicon.svg" type="image/svg+xml"></link>
			</head>
			<body>{children}</body>
		</html>
	);
}
