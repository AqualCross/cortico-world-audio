/** 平台差异集中在这里：结束进程树、播放兜底命令、字幕与系统能力。 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';

export const isWindows = process.platform === 'win32';
export const isMac = process.platform === 'darwin';

/** 结束一个进程和它的子进程：Windows 用 taskkill，POSIX 用信号。 */
export function killTree(pid: number): void {
  if (isWindows) {
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    return;
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // 已经退出
  }
  try {
    spawn('pkill', ['-KILL', '-P', String(pid)], { stdio: 'ignore' });
  } catch {
    // 没有 pkill 也不影响主进程
  }
}

/** 没有 audify 时的系统播放器：macOS afplay；Linux ffplay（随 ffmpeg 一起装）。 */
export function fallbackPlayer(ffmpeg: string, path: string, volume: number): { cmd: string; args: string[] } | null {
  if (isMac) return { cmd: 'afplay', args: ['-v', String(Math.max(0, Math.min(1, volume / 100))), path] };
  if (isWindows) return null;
  const cmd = ffmpeg ? join(dirname(ffmpeg), 'ffplay') : 'ffplay';
  return { cmd, args: ['-nodisp', '-autoexit', '-volume', String(Math.max(0, Math.min(100, Math.round(volume)))), path] };
}
