import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const distDir = resolve("dist");
const manifestPath = resolve(distDir, "manifest.json");

if (!existsSync(manifestPath)) {
  throw new Error("dist/manifest.json does not exist. Run pnpm build first.");
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

if (manifest.version !== packageJson.version) {
  throw new Error(`manifest version ${manifest.version} does not match package version ${packageJson.version}`);
}

const referencedFiles = [
  ...Object.values(manifest.icons ?? {}),
  ...(manifest.content_scripts ?? []).flatMap((entry) => entry.js ?? []),
  manifest.background?.service_worker
].filter((value) => typeof value === "string");

for (const file of referencedFiles) {
  if (!existsSync(resolve(distDir, file))) {
    throw new Error(`manifest references a missing build artifact: ${file}`);
  }
}

const releaseDir = resolve("release");
const zipName = `${packageJson.name}-v${packageJson.version}.zip`;
const zipPath = resolve(releaseDir, zipName);

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
  cwd: distDir,
  stdio: "inherit"
});

console.log(`Created ${zipPath}`);
