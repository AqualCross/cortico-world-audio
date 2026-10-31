/** ffmpeg：先找配置、再找 PATH（解析成真实路径），都没有才下载静态包。 */
import { chmodSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { downloadVerified, extractTarXz, extractZip } from './download.ts';
import { isWindows } from './platform.ts';

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

/** 静态包：BtbN 的 Windows/Linux 构建，以及 macOS 的 evermeet（Intel）与 osxexperts（arm64）。 */
export const FFMPEG_BUILD = 'autobuild-2026-11-01-12-49';
const BTBN_NAME = 'ffmpeg-N-128273-g836436cfb9';
const btbnUrl = (file: string, prefix = ''): string => `${prefix}https://github.com/BtbN/FFmpeg-Builds/releases/download/${FFMPEG_BUILD}/${file}`;
const btbnSources = (file: string): string[] => [btbnUrl(file, 'https://ghfast.top/'), btbnUrl(file, 'https://gh-proxy.com/'), btbnUrl(file)];

export interface FfmpegAsset {
  name: string;
  bytes: number;
  sha256: string;
  archive: 'zip' | 'tar.xz';
  urls: readonly string[];
  /** 归档里要装的可执行文件名（不含 Windows 的 .exe）。 */
  binaries: readonly ('ffmpeg' | 'ffprobe')[];
}

const BTBN_WIN64 = `${BTBN_NAME}-win64-gpl.zip`;
const BTBN_WINARM64 = `${BTBN_NAME}-winarm64-gpl.zip`;
const BTBN_LINUX64 = `${BTBN_NAME}-linux64-gpl.tar.xz`;
const BTBN_LINUXARM64 = `${BTBN_NAME}-linuxarm64-gpl.tar.xz`;

const FFMPEG_ASSETS: Readonly<Record<string, FfmpegAsset>> = {
  'win32-x64': { name: BTBN_WIN64, bytes: 201_757_577, sha256: 'ad99b0b94e68f2932391ad982c193b847c93ba41f17b7cafbf50710e15d45185', archive: 'zip', urls: btbnSources(BTBN_WIN64), binaries: ['ffmpeg', 'ffprobe'] },
  'win32-arm64': { name: BTBN_WINARM64, bytes: 142_365_154, sha256: '2a8b73ee16fd7291dbb79575737b0f1bdd69ca0c9cc698463de9762eaa4adcc3', archive: 'zip', urls: btbnSources(BTBN_WINARM64), binaries: ['ffmpeg', 'ffprobe'] },
  'linux-x64': { name: BTBN_LINUX64, bytes: 157_419_352, sha256: 'afdb03bfa9e6cfaa4587a1d663d7475bdbc7af40fe4156cacc6dba2c36f82b85', archive: 'tar.xz', urls: btbnSources(BTBN_LINUX64), binaries: ['ffmpeg', 'ffprobe'] },
  'linux-arm64': { name: BTBN_LINUXARM64, bytes: 132_513_848, sha256: '4ba9cddb940a0cdbfd8fda5fa72566a660b9310803c37b7d7286786f2fa80a6c', archive: 'tar.xz', urls: btbnSources(BTBN_LINUXARM64), binaries: ['ffmpeg', 'ffprobe'] },
  'darwin-x64': { name: 'ffmpeg-9.0.2.zip', bytes: 26_198_325, sha256: '4acc0be580f9b2788029eb7bd4d645ff87968911b0a62aeeb3940d42d54558d5', archive: 'zip', urls: ['https://evermeet.cx/ffmpeg/ffmpeg-9.0.2.zip'], binaries: ['ffmpeg'] },
  'darwin-arm64': { name: 'ffmpeg902arm.zip', bytes: 22_665_869, sha256: '07e00300593799005b060c03a99fe648b1edda0f30c36b0c1adafe8e3247e586', archive: 'zip', urls: ['https://www.osxexperts.net/ffmpeg902arm.zip'], binaries: ['ffmpeg'] },
};

/** 这台机器该下哪一份；没有对应资产时返回 null。 */
export function ffmpegAssetFor(platform: string = process.platform, arch: string = process.arch): FfmpegAsset | null {
  return FFMPEG_ASSETS[`${platform}-${arch}`] ?? null;
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
  await downloadVerified([...asset.urls], archive, { signal, onBytes, bytes: asset.bytes, sha256: asset.sha256 });
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
