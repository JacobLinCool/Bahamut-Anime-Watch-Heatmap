import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8"));

if (manifest.version !== packageJson.version) {
  throw new Error(`manifest version ${manifest.version} does not match package version ${packageJson.version}`);
}

const releaseDir = resolve("release");
const zipName = `${packageJson.name}-v${packageJson.version}.zip`;
const zipPath = resolve(releaseDir, zipName);

if (!existsSync("dist/manifest.json")) {
  throw new Error("dist/manifest.json does not exist. Run pnpm build first.");
}

mkdirSync(releaseDir, { recursive: true });
rmSync(zipPath, { force: true });

execFileSync("zip", [
  "-r",
  "-q",
  zipPath,
  ".",
  "-x",
  "*.map",
  ".DS_Store",
  "__MACOSX/*"
], {
  cwd: resolve("dist"),
  stdio: "inherit"
});

console.log(`Created ${zipPath}`);
