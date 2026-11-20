/** ffmpeg：先找配置、再找 PATH（解析成真实路径），都没有才下载静态包。 */
import { chmodSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { downloadVerified, extractTarXz, extractZip } from './download.ts';
import { isWindows } from './platform.ts';
import { fetchWithProxy } from './proxy.ts';

export type FfmpegSource = 'config' | 'path' | 'installed';

export interface FfmpegInfo {
  path: string | null;
  version: string | null;
  source: FfmpegSource | null;
  detail: string | null;
}

/**
 * 在 PATH 里找可执行文件的真实位置（Windows 按 PATHEXT 补扩展名）。
 * 用户装在哪就认哪，不去猜固定目录；找不到返回 null。
 */
export function resolveOnPath(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const dirs = String(env.PATH ?? env.Path ?? '')
    .split(delimiter)
    .map((dir) => dir.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
  const exts = String(env.PATHEXT ?? (process.platform === 'win32' ? '.EXE;.CMD;.BAT;.COM' : ''))
    .split(';')
    .filter(Boolean);
  const names = [name, ...exts.flatMap((ext) => [`${name}${ext.toLowerCase()}`, `${name}${ext.toUpperCase()}`])];
  for (const dir of dirs) {
    for (const file of names) {
      const full = join(dir, file);
      if (existsSync(full)) return full;
    }
  }
  return null;
}

/** `ffmpeg version 7.1-full_build-www.gyan.dev ...` → `7.1-full_build-www.gyan.dev`。 */
export function parseFfmpegVersion(stdout: string): string | null {
  const m = /ffmpeg version (\S+)/i.exec(stdout);
  return m ? m[1] : null;
}

function run(cmd: string, args: string[], timeoutMs = 4000): Promise<{ code: number | null; stdout: string; stderr: string; error: NodeJS.ErrnoException | null }> {
  return new Promise((done) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (r: { code: number | null; stdout: string; stderr: string; error: NodeJS.ErrnoException | null }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done(r);
    };
    const child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      child.kill();
      finish({ code: null, stdout, stderr, error: null });
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', (err: NodeJS.ErrnoException) => finish({ code: null, stdout, stderr, error: err }));
    child.on('close', (code) => finish({ code, stdout, stderr, error: null }));
  });
}

/** 问一次 `ffmpeg -version`（版本行写在 stdout，部分构建写在 stderr）。 */
export async function probeFfmpeg(path: string): Promise<string | null> {
  if (path !== 'ffmpeg' && !existsSync(path)) return null;
  const result = await run(path, ['-version']);
  if (result.error?.code === 'ENOENT') return null;
  return parseFfmpegVersion(`${result.stdout}\n${result.stderr}`);
}

export async function detectFfmpeg(override = ''): Promise<FfmpegInfo> {
  const tried: string[] = [];
  const candidates: Array<{ path: string; source: FfmpegSource }> = [];
  if (override.trim()) candidates.push({ path: resolve(override.trim()), source: 'config' });
  const onPath = resolveOnPath('ffmpeg');
  if (onPath) candidates.push({ path: onPath, source: 'path' });
  for (const candidate of candidates) {
    const version = await probeFfmpeg(candidate.path);
    if (version) return { path: candidate.path, version, source: candidate.source, detail: null };
    tried.push(candidate.path);
  }
  return { path: null, version: null, source: null, detail: tried.length ? `试过 ${tried.length} 处，都不像 ffmpeg` : '没有找到 ffmpeg' };
}

/**
 * 静态包：BtbN 的 Windows/Linux 构建，以及 macOS 的 evermeet（Intel）与 osxexperts（arm64）。
 * BtbN 只保留最近几天的 autobuild，钉死某个 tag 过几天就会 404；`latest` 标签下资产名固定，
 * 内容每天随构建更新。所以 Windows/Linux 不把大小与 SHA-256 写死在代码里，下载前从同一
 * release 的 checksums.sha256 现取哈希。
 */
export const FFMPEG_RELEASE = 'latest';
const BTBN_NAME = 'ffmpeg-master';
const btbnUrl = (file: string, prefix = ''): string => `${prefix}https://github.com/BtbN/FFmpeg-Builds/releases/download/${FFMPEG_RELEASE}/${file}`;
const btbnSources = (file: string): string[] => [btbnUrl(file, 'https://ghfast.top/'), btbnUrl(file, 'https://gh-proxy.com/'), btbnUrl(file)];

export interface FfmpegAsset {
  name: string;
  /** 钉死的大小与 SHA-256；BtbN 的滚动资产为 null，改从 checksums 现查。 */
  bytes: number | null;
  sha256: string | null;
  /** 滚动资产的 SHA-256 清单地址（与压缩包同一 release）。 */
  checksums?: readonly string[];
  archive: 'zip' | 'tar.xz';
  urls: readonly string[];
  /** 归档里要装的可执行文件名（不含 Windows 的 .exe）。 */
  binaries: readonly ('ffmpeg' | 'ffprobe')[];
}

const BTBN_WIN64 = `${BTBN_NAME}-latest-win64-gpl.zip`;
const BTBN_WINARM64 = `${BTBN_NAME}-latest-winarm64-gpl.zip`;
const BTBN_LINUX64 = `${BTBN_NAME}-latest-linux64-gpl.tar.xz`;
const BTBN_LINUXARM64 = `${BTBN_NAME}-latest-linuxarm64-gpl.tar.xz`;

const btbnAsset = (name: string): FfmpegAsset => ({
  name,
  bytes: null,
  sha256: null,
  checksums: btbnSources('checksums.sha256'),
  archive: name.endsWith('.zip') ? 'zip' : 'tar.xz',
  urls: btbnSources(name),
  binaries: ['ffmpeg', 'ffprobe'],
});

const FFMPEG_ASSETS: Readonly<Record<string, FfmpegAsset>> = {
  'win32-x64': btbnAsset(BTBN_WIN64),
  'win32-arm64': btbnAsset(BTBN_WINARM64),
  'linux-x64': btbnAsset(BTBN_LINUX64),
  'linux-arm64': btbnAsset(BTBN_LINUXARM64),
  'darwin-x64': { name: 'ffmpeg-9.0.2.zip', bytes: 26_198_325, sha256: '4acc0be580f9b2788029eb7bd4d645ff87968911b0a62aeeb3940d42d54558d5', archive: 'zip', urls: ['https://evermeet.cx/ffmpeg/ffmpeg-9.0.2.zip'], binaries: ['ffmpeg'] },
  'darwin-arm64': { name: 'ffmpeg902arm.zip', bytes: 22_665_869, sha256: '07e00300593799005b060c03a99fe648b1edda0f30c36b0c1adafe8e3247e586', archive: 'zip', urls: ['https://www.osxexperts.net/ffmpeg902arm.zip'], binaries: ['ffmpeg'] },
};

/** 这台机器该下哪一份；没有对应资产时返回 null。 */
export function ffmpegAssetFor(platform: string = process.platform, arch: string = process.arch): FfmpegAsset | null {
  return FFMPEG_ASSETS[`${platform}-${arch}`] ?? null;
}

/** 从 `checksums.sha256` 里取某个文件的 SHA-256。行格式是 `<64 位十六进制>  <文件名>`。 */
export function parseChecksums(text: string, name: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})\s+\*?(.+?)\s*$/i.exec(line);
    if (!match) continue;
    const file = match[2].replace(/^\.\//, '').split(/[\\/]/).pop();
    if (file === name) return match[1].toLowerCase();
  }
  return null;
}

/** 滚动资产的 SHA-256：清单和压缩包同一 release，按同样的镜像顺序取。 */
async function checksumFor(asset: FfmpegAsset, signal: AbortSignal): Promise<string | undefined> {
  if (asset.sha256) return asset.sha256;
  const errors: string[] = [];
  for (const url of asset.checksums ?? []) {
    try {
      const res = await fetchWithProxy(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const sha256 = parseChecksums(await res.text(), asset.name);
      if (sha256) return sha256;
      throw new Error(`清单里没有 ${asset.name}`);
    } catch (err) {
      if (signal.aborted) throw err;
      errors.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(`取不到 ${asset.name} 的校验和：\n${errors.slice(-3).join('\n')}`);
}

/** 下载静态包，把 ffmpeg（Windows 上还有 ffprobe）放到 `<into>/`。 */
export async function installFfmpeg(into: string, signal: AbortSignal, onBytes?: (n: number) => void): Promise<FfmpegInfo> {
  const asset = ffmpegAssetFor();
  if (!asset) {
    throw new Error(`没有 ${process.platform}-${process.arch} 的 ffmpeg 独立包：用包管理器安装后从 PATH 识别。`);
  }
  mkdirSync(into, { recursive: true });
  const tmp = join(into, '.tmp');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const archive = join(tmp, asset.archive === 'zip' ? 'ffmpeg.zip' : 'ffmpeg.tar.xz');
  const sha256 = await checksumFor(asset, signal);
  await downloadVerified([...asset.urls], archive, { signal, onBytes, bytes: asset.bytes ?? undefined, sha256 });
  if (asset.archive === 'zip') await extractZip(archive, tmp);
  else await extractTarXz(archive, tmp);
  rmSync(archive, { force: true });
  const suffix = isWindows ? '.exe' : '';
  const found = findBinaries(tmp, asset.binaries, suffix);
  if (!found.ffmpeg) throw new Error(`压缩包里没有 ffmpeg${suffix}`);
  for (const name of asset.binaries) {
    const src = found[name];
    if (!src) continue;
    const dest = join(into, `${name}${suffix}`);
    rmSync(dest, { force: true });
    renameSync(src, dest);
    if (!isWindows) chmodSync(dest, 0o755);
  }
  rmSync(tmp, { recursive: true, force: true });
  const ffmpegPath = join(into, `ffmpeg${suffix}`);
  const version = await probeFfmpeg(ffmpegPath);
  if (!version) throw new Error('装好的 ffmpeg 起不来（-version 失败）');
  return { path: ffmpegPath, version, source: 'installed', detail: null };
}

function findBinaries(dir: string, want: readonly string[], suffix: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      Object.assign(found, findBinaries(path, want, suffix));
      continue;
    }
    const lower = entry.toLowerCase();
    for (const name of want) {
      if (lower === `${name}${suffix}`.toLowerCase()) found[name] = path;
    }
  }
  return found;
}
