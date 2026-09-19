import { readFile } from "node:fs/promises";

const tag = process.env.GITHUB_REF_NAME;
const root = new URL("../", import.meta.url);
const packageJson = JSON.parse(await readFile(new URL("package.json", root)));
const tauriConfig = JSON.parse(
  await readFile(new URL("src-tauri/tauri.conf.json", root)),
);
const cargoManifest = await readFile(
  new URL("src-tauri/Cargo.toml", root),
  "utf8",
);
const cargoVersion = cargoManifest.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const expectedTag = `v${packageJson.version}`;

if (
  tag !== expectedTag ||
  tauriConfig.version !== packageJson.version ||
  cargoVersion !== packageJson.version
) {
  throw new Error(
    `Tag (${tag ?? "missing"}), package (${packageJson.version}), Tauri (${tauriConfig.version}), and Cargo (${cargoVersion ?? "missing"}) versions must match.`,
  );
}

console.log(
  `Release tag ${tag} matches package version ${packageJson.version}.`,
);
