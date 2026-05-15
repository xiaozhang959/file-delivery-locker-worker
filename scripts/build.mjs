import { execFileSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const isWindows = process.platform === "win32";

const command = process.env.NEXT_PRIVATE_STANDALONE === "true" ? "next" : "opennextjs-cloudflare";
const args = process.env.NEXT_PRIVATE_STANDALONE === "true" ? ["build"] : ["build"];
const bin = path.join(root, "node_modules", ".bin", isWindows ? `${command}.cmd` : command);

execFileSync(bin, args, {
	cwd: root,
	env: process.env,
	stdio: "inherit",
});
