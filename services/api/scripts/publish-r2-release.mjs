import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const requiredVariables = [
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_ENDPOINT",
  "R2_BUCKET",
  "R2_PUBLIC_BASE_URL",
  "RELEASE_REGISTRY_URL",
  "RELEASE_REGISTRY_TOKEN",
  "RELEASE_VERSION",
  "RELEASE_PLATFORM",
  "RELEASE_ARCH",
  "RELEASE_UPDATER_ARCHES",
];

for (const name of requiredVariables) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}

const projectRoot = process.cwd();
const bundleRoot = path.join(projectRoot, "apps/desktop/src-tauri/target");
const installerExtensions = new Set([".dmg", ".deb", ".AppImage", ".exe"]);
const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(entryPath) : [entryPath];
  }));
  return files.flat();
}

function extension(filePath) {
  return filePath.endsWith(".AppImage") ? ".AppImage" : path.extname(filePath);
}

function contentType(filePath) {
  if (filePath.endsWith(".dmg")) return "application/x-apple-diskimage";
  if (filePath.endsWith(".deb")) return "application/vnd.debian.binary-package";
  if (filePath.endsWith(".AppImage")) return "application/vnd.appimage";
  if (filePath.endsWith(".exe")) return "application/vnd.microsoft.portable-executable";
  if (filePath.endsWith(".zip")) return "application/zip";
  if (filePath.endsWith(".tar.gz")) return "application/gzip";
  return "application/octet-stream";
}

function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const input = createReadStream(filePath);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

async function uploadFile(filePath, objectKey) {
  const checksum = await sha256(filePath);
  const { size } = await stat(filePath);
  await s3.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: objectKey,
    Body: createReadStream(filePath),
    ContentLength: size,
    ContentType: contentType(filePath),
    Metadata: { sha256: checksum },
  }));
  return { checksum, size };
}

const files = await walk(bundleRoot);
const bundleFiles = files.filter((filePath) => filePath.split(path.sep).includes("bundle"));
const installers = bundleFiles.filter((filePath) => installerExtensions.has(extension(filePath)));
if (installers.length === 0) throw new Error(`No release binary found below ${bundleRoot}`);

const channel = process.env.RELEASE_VERSION.includes("-") ? "beta" : "stable";
const releasePrefix = [
  "releases",
  `v${process.env.RELEASE_VERSION}`,
  process.env.RELEASE_PLATFORM,
  process.env.RELEASE_ARCH,
].join("/");
const registryUrl = new URL("v1/app-releases/artifacts", `${process.env.RELEASE_REGISTRY_URL.replace(/\/$/, "")}/`);

for (const filePath of installers) {
  const fileName = path.basename(filePath);
  const objectKey = `${releasePrefix}/${fileName}`;
  const { checksum, size } = await uploadFile(filePath, objectKey);

  const response = await fetch(registryUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.RELEASE_REGISTRY_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      version: process.env.RELEASE_VERSION,
      channel,
      platform: process.env.RELEASE_PLATFORM,
      arch: process.env.RELEASE_ARCH,
      fileName,
      objectKey,
      sha256: checksum,
      size,
    }),
  });

  if (!response.ok) {
    throw new Error(`Release registry returned ${response.status}: ${await response.text()}`);
  }

  console.log(`Published ${fileName} (${checksum})`);
}

const updaterFile = process.env.RELEASE_PLATFORM === "darwin"
  ? bundleFiles.find((filePath) => filePath.endsWith(".app.tar.gz"))
  : process.env.RELEASE_PLATFORM === "windows"
    ? bundleFiles.find((filePath) => filePath.split(path.sep).includes("nsis") && /-setup\.exe$/i.test(filePath))
    : bundleFiles.find((filePath) => filePath.endsWith(".AppImage"));
if (!updaterFile) throw new Error(`No updater bundle found for ${process.env.RELEASE_PLATFORM}`);

const signatureFile = `${updaterFile}.sig`;
if (!bundleFiles.includes(signatureFile)) throw new Error(`No updater signature found for ${path.basename(updaterFile)}`);

const updaterFileName = path.basename(updaterFile);
const updaterObjectKey = `${releasePrefix}/${updaterFileName}`;
const existingInstaller = installers.includes(updaterFile);
const updaterUpload = existingInstaller
  ? { checksum: await sha256(updaterFile), size: (await stat(updaterFile)).size }
  : await uploadFile(updaterFile, updaterObjectKey);
const signature = (await readFile(signatureFile, "utf8")).trim();
if (!signature) throw new Error(`Updater signature is empty for ${updaterFileName}`);

const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL.replace(/\/$/, "");
const encodedUpdaterKey = updaterObjectKey.split("/").map(encodeURIComponent).join("/");
const downloadUrl = `${publicBaseUrl}/${encodedUpdaterKey}?sha256=${updaterUpload.checksum}`;
const updaterManifest = JSON.stringify({
  version: process.env.RELEASE_VERSION,
  pub_date: new Date().toISOString(),
  url: downloadUrl,
  signature,
  notes: `Sillage ${process.env.RELEASE_VERSION}`,
});

for (const updaterArch of process.env.RELEASE_UPDATER_ARCHES.split(",").map((value) => value.trim()).filter(Boolean)) {
  const manifestKey = `updates/${channel}/${process.env.RELEASE_PLATFORM}/${updaterArch}/latest.json`;
  await s3.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: manifestKey,
    Body: updaterManifest,
    ContentLength: Buffer.byteLength(updaterManifest),
    ContentType: "application/json",
    CacheControl: "no-cache, max-age=0",
  }));
  console.log(`Published updater manifest ${manifestKey}`);
}
