/** 下载、校验与解压：断点续传、SHA-256、纯 JS 解 zip（不依赖系统 unzip/bsdtar）。 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import extract from 'extract-zip';
import { x as extractTar } from 'tar';
import { XzReadableStream } from 'xz-decompress';
import { fetchWithProxy } from './proxy.ts';

export interface DownloadOptions {
  signal: AbortSignal;
  /** 已收到的字节增量。 */
  onBytes?: (bytes: number) => void;
  /** 从已有文件续传；服务器不认 Range 时整段重下。 */
  resume?: boolean;
  /** 服务器给了 Content-Length 时报一次总字节数（含已续传的部分）。 */
  onTotal?: (bytes: number) => void;
  /** 这个文件当前写到了多少字节（含续传部分），重试后会从新值重来。 */
  onProgress?: (bytes: number) => void;
  /** 多久没有新字节就算停滞（毫秒），默认 60 秒。 */
  stallMs?: number;
}

/** 把一个地址下到 `dest`。返回最终字节数。 */
export async function download(url: string, dest: string, opts: DownloadOptions): Promise<number> {
  const { signal, onBytes, onProgress, resume = true, onTotal, stallMs = 60_000 } = opts;
  const existing = resume && existsSync(dest) ? statSync(dest).size : 0;
  const res = await fetchWithProxy(url, {
    signal,
    redirect: 'follow',
    headers: existing > 0 ? { range: `bytes=${existing}-` } : undefined,
  });
  if (!res.ok || !res.body) {
    if (res.status === 416 && existing > 0) return existing;
    throw new Error(`HTTP ${res.status} ${url}`);
  }
  const append = existing > 0 && res.status === 206;
  if (!append && existing > 0) rmSync(dest, { force: true });
  const length = Number(res.headers.get('content-length') ?? 0);
  if (length > 0 && onTotal) onTotal((append ? existing : 0) + length);

  // 连接卡住不算失败：一段时间没有新字节就掐掉这次尝试，交给上层续传重试。
  let written = append ? existing : 0;
  const stall = new AbortController();
  const onOuterAbort = (): void => stall.abort(signal.reason);
  signal.addEventListener('abort', onOuterAbort, { once: true });
  let timer = setTimeout(() => stall.abort(new Error(`下载停滞 ${Math.round(stallMs / 1000)} 秒`)), stallMs);
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      written += chunk.length;
      clearTimeout(timer);
      timer = setTimeout(() => stall.abort(new Error(`下载停滞 ${Math.round(stallMs / 1000)} 秒`)), stallMs);
      onBytes?.(chunk.length);
      onProgress?.(written);
      cb(null, chunk);
    },
  });
  mkdirSync(dirname(dest), { recursive: true });
  try {
    await pipeline(
      Readable.fromWeb(res.body as import('node:stream/web').ReadableStream),
      counter,
      createWriteStream(dest, { flags: append ? 'a' : 'w' }),
      { signal: stall.signal },
    );
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onOuterAbort);
  }
  return statSync(dest).size;
}

export function sha256File(file: string): Promise<string> {
  return new Promise((done, fail) => {
    const hash = createHash('sha256');
    const stream = createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', fail);
    stream.once('end', () => done(hash.digest('hex')));
  });
}

/** 按顺序试来源，直到大小（与给了的 SHA-256）都对上。每个来源失败后换下一个。 */
export async function downloadVerified(
  sources: readonly string[],
  dest: string,
  opts: { bytes?: number; sha256?: string; signal: AbortSignal; onBytes?: (n: number) => void; onTotal?: (n: number) => void; onProgress?: (n: number) => void; attempts?: number },
): Promise<void> {
  const { bytes, sha256, signal, onBytes, onTotal, onProgress, attempts = 3 } = opts;
  const errors: string[] = [];
  for (const url of sources) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await download(url, dest, { signal, onBytes, onTotal, onProgress, resume: true });
        const size = statSync(dest).size;
        if (bytes && size !== bytes) {
          // 错误页也常是 200：留下的字节会污染下一次（续传）尝试，先删掉。
          rmSync(dest, { force: true });
          throw new Error(`大小 ${size}，应为 ${bytes}`);
        }
        if (sha256 && (await sha256File(dest)) !== sha256) {
          rmSync(dest, { force: true });
          throw new Error('SHA-256 不符');
        }
        return;
      } catch (err) {
        if (signal.aborted) throw err;
        errors.push(`${url}${attempt > 1 ? `（第 ${attempt} 次）` : ''}: ${err instanceof Error ? err.message : String(err)}`);
        if (attempt === attempts) break;
      }
    }
  }
  throw new Error(errors.slice(-4).join('\n') || '没有下载来源');
}

/** 解 zip：纯 JS 的 extract-zip，三个平台同一套逻辑，不依赖系统工具。 */
export async function extractZip(archive: string, into: string): Promise<void> {
  try {
    await extract(resolve(archive), { dir: resolve(into) });
  } catch (err) {
    const name = archive.split(/[\\/]/).pop() ?? '压缩包';
    throw new Error(`解压 ${name} 失败：${err instanceof Error ? err.message : String(err)}`);
  }
}

/** 解 .tar.gz：纯 JS 的 tar，不依赖系统 tar / gzip。 */
export async function extractTarGz(archive: string, into: string): Promise<void> {
  try {
    mkdirSync(resolve(into), { recursive: true });
    await extractTar({ file: resolve(archive), cwd: resolve(into), strict: true });
  } catch (err) {
    const name = archive.split(/[\\/]/).pop() ?? '压缩包';
    throw new Error(`解压 ${name} 失败：${err instanceof Error ? err.message : String(err)}`);
  }
}

/** 解 .tar.xz：先经 WASM 解 xz 得到临时 tar，再交给纯 JS tar 解包。 */
export async function extractTarXz(archive: string, into: string): Promise<void> {
  const target = resolve(into);
  const tmpTar = resolve(into, '.extract.tar');
  try {
    mkdirSync(target, { recursive: true });
    const xz = new XzReadableStream(Readable.toWeb(createReadStream(resolve(archive))) as ReadableStream<Uint8Array>);
    await pipeline(Readable.fromWeb(xz as unknown as import('node:stream/web').ReadableStream<Uint8Array>), createWriteStream(tmpTar));
    await extractTar({ file: tmpTar, cwd: target, strict: true });
  } catch (err) {
    const name = archive.split(/[\\/]/).pop() ?? '压缩包';
    throw new Error(`解压 ${name} 失败：${err instanceof Error ? err.message : String(err)}`);
  } finally {
    rmSync(tmpTar, { force: true });
  }
}
