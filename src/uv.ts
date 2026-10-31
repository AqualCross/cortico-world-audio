/** uv：先看配置，再认 PATH 上的 uv（裸名直接用），都没有才下载一份到自己目录。 */
import { chmodSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { downloadVerified, extractTarGz, extractZip } from './download.ts';
import { isWindows } from './platform.ts';

export type UvSource = 'config' | 'path' | 'installed';

export interface UvInfo {
  path: string | null;
  version: string | null;
  source: UvSource | null;
  /** 识别不到时的说明。 */
  detail: string | null;
}

/** `uv 0.8.15 (abc1234 2025-09-01)` → `0.8.15`。 */
export function parseUvVersion(stdout: string): string | null {
  const m = /^uv\s+(\S+)/m.exec(stdout.trim());
  return m ? m[1] : null;
}

function run(cmd: string, args: string[], timeoutMs = 4000): Promise<{ code: number | null; stdout: string; stderr: string; error: NodeJS.ErrnoException | null }> {
  return new Promise((done) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result: { code: number | null; stdout: string; stderr: string; error: NodeJS.ErrnoException | null }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done(result);
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

/** 问一次 `uv --version`；拿到版本就算可用。 */
export async function probeUv(path: string): Promise<string | null> {
  if (path !== 'uv' && !existsSync(path)) return null;
  const result = await run(path, ['--version']);
  return result.code === 0 ? parseUvVersion(result.stdout) : null;
}

export async function detectUv(override = ''): Promise<UvInfo> {
  const tried: string[] = [];
  const candidates: Array<{ path: string; source: UvSource }> = [];
  if (override.trim()) candidates.push({ path: resolve(override.trim()), source: 'config' });
  candidates.push({ path: 'uv', source: 'path' });
  for (const candidate of candidates) {
    if (candidate.path !== 'uv' && !existsSync(candidate.path)) continue;
    const version = await probeUv(candidate.path);
    if (version) return { path: candidate.path === 'uv' ? 'uv' : candidate.path, version, source: candidate.source, detail: null };
    tried.push(candidate.path);
  }
  return { path: null, version: null, source: null, detail: tried.length ? `试过 ${tried.length} 处，都不像 uv` : '没有找到 uv' };
}

/** 官方独立包，版本与哈希固定；每个平台一份资产。 */
export const UV_VERSION = '0.13.7';

export interface UvAsset {
  /** release 资产文件名。 */
  name: string;
  bytes: number;
  sha256: string;
  /** 归档里的可执行文件名（Windows 带 .exe）。 */
  binary: string;
}

const UV_ASSETS: Readonly<Record<string, UvAsset>> = {
  'win32-x64': { name: 'uv-x86_64-pc-windows-msvc.zip', bytes: 15_236_317, sha256: '0cdc5b38fe5a8168ed6a25814f5ba43c21d313dd3187314fccb37b7cec46e021', binary: 'uv.exe' },
  'win32-arm64': { name: 'uv-aarch64-pc-windows-msvc.zip', bytes: 15_538_425, sha256: '505d9e65e7692bac3ddf98c66754aa26c5050c409c184af30a881a0a72cc85e3', binary: 'uv.exe' },
  'darwin-x64': { name: 'uv-x86_64-apple-darwin.tar.gz', bytes: 17_026_382, sha256: '20c47e4c1f630b8abaff8c291fa9b9aa300fef92c4fbff95adf198b55287cda7', binary: 'uv' },
  'darwin-arm64': { name: 'uv-aarch64-apple-darwin.tar.gz', bytes: 14_347_867, sha256: '81b811b57e4624df7ed3aac148e0359100d9962f3d9dce00aec533dc2e086731', binary: 'uv' },
  'linux-x64': { name: 'uv-x86_64-unknown-linux-gnu.tar.gz', bytes: 16_671_812, sha256: 'c5221ff41b7892bfc223543883600125f6a47fe845093e0f5bdff4f359196d83', binary: 'uv' },
  'linux-arm64': { name: 'uv-aarch64-unknown-linux-gnu.tar.gz', bytes: 15_896_996, sha256: '71279f8d3c67241e807b9d8db872d1bf541579fb9f08b7d1eb1682196d1e57dc', binary: 'uv' },
};

/** 这台机器该下哪一份；没有对应资产时返回 null。 */
export function uvAssetFor(platform: string = process.platform, arch: string = process.arch): UvAsset | null {
  return UV_ASSETS[`${platform}-${arch}`] ?? null;
}

/** 下载地址：镜像在前，GitHub 在后。 */
export function uvSources(name: string): string[] {
  const url = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${name}`;
  return [`https://ghfast.top/${url}`, `https://gh-proxy.com/${url}`, url];
}

/**
 * 下载并安装 uv 到 `<into>/uv(.exe)`，已有就先删掉再放。
 * 下载与解压都在 `<into>/.tmp` 里做，最后只留可执行文件。
 */
export async function installUv(into: string, signal: AbortSignal, onBytes?: (n: number) => void): Promise<UvInfo> {
  const asset = uvAssetFor();
  if (!asset) {
    throw new Error(`没有 ${process.platform}-${process.arch} 的 uv 独立包：用包管理器或官方安装脚本装好后会从 PATH 识别。`);
  }
  mkdirSync(into, { recursive: true });
  const tmp = join(into, '.tmp');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const archive = join(tmp, asset.name.endsWith('.zip') ? 'uv.zip' : 'uv.tar.gz');
  await downloadVerified(uvSources(asset.name), archive, { signal, onBytes, bytes: asset.bytes, sha256: asset.sha256 });
  if (asset.name.endsWith('.zip')) await extractZip(archive, tmp);
  else await extractTarGz(archive, tmp);
  rmSync(archive, { force: true });
  const exe = findUvBinary(tmp, asset.binary);
  if (!exe) throw new Error(`压缩包里没有 ${asset.binary}`);
  const dest = join(into, asset.binary);
  rmSync(dest, { force: true });
  renameSync(exe, dest);
  if (!isWindows) chmodSync(dest, 0o755);
  rmSync(tmp, { recursive: true, force: true });
  const version = await probeUv(dest);
  if (!version) throw new Error('装好的 uv 起不来（--version 失败）');
  return { path: dest, version, source: 'installed', detail: null };
}

function findUvBinary(dir: string, name: string): string | null {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      const nested = findUvBinary(path, name);
      if (nested) return nested;
    } else if (entry.toLowerCase() === name.toLowerCase()) {
      return path;
    }
  }
  return null;
}
