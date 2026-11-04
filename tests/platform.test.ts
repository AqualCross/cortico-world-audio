import { describe, expect, it } from 'vitest';
import { panFilter } from '../src/platform.ts';

describe('ffplay 左右平衡', () => {
  it('居中不加滤镜', () => {
    expect(panFilter(0)).toBe(null);
    expect(panFilter(Number.NaN)).toBe(null);
  });

  it('偏右压左声道，偏左压右声道，越界掐到两端', () => {
    expect(panFilter(50)).toBe('pan=stereo|c0=0.500*c0|c1=1.000*c1');
    expect(panFilter(-50)).toBe('pan=stereo|c0=1.000*c0|c1=0.500*c1');
    expect(panFilter(200)).toBe('pan=stereo|c0=0.000*c0|c1=1.000*c1');
    expect(panFilter(-200)).toBe('pan=stereo|c0=1.000*c0|c1=0.000*c1');
  });
});
