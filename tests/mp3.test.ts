import { describe, expect, it } from 'vitest';

import { estimateMp3DurationMs } from '@/lib/mp3';

/** MPEG1 Layer III, 128 kbps, 44100 Hz 的帧头（无 ID3、无 CRC 保护） */
const MPEG1_L3_128_44100 = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
const FRAME_BYTES = Math.floor((144 * 128_000) / 44_100); // 417

function cbrMp3(frameCount: number) {
  const mp3 = Buffer.alloc(frameCount * FRAME_BYTES);
  for (let i = 0; i < frameCount; i += 1) {
    MPEG1_L3_128_44100.copy(mp3, i * FRAME_BYTES);
  }
  return mp3;
}

function withId3v2(mp3: Buffer, tagSize = 8) {
  const header = Buffer.alloc(10);
  header.set([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]); // "ID3", v2.4, no flags
  header[6] = (tagSize >> 21) & 0x7f;
  header[7] = (tagSize >> 14) & 0x7f;
  header[8] = (tagSize >> 7) & 0x7f;
  header[9] = tagSize & 0x7f;
  return Buffer.concat([header, Buffer.alloc(tagSize), mp3]);
}

function xingMp3(frameCount: number) {
  // 首帧的 side info 之后放 Xing 头（MPEG1 Layer III 的 side info 为 32 字节）
  const first = Buffer.alloc(FRAME_BYTES);
  MPEG1_L3_128_44100.copy(first, 0);
  first.set([0x58, 0x69, 0x6e, 0x67], 36); // "Xing"
  first.writeUInt32BE(frameCount, 44);
  const rest = Buffer.alloc((frameCount - 1) * FRAME_BYTES);
  for (let i = 0; i < frameCount - 1; i += 1) {
    MPEG1_L3_128_44100.copy(rest, i * FRAME_BYTES);
  }
  return Buffer.concat([first, rest]);
}

describe('estimateMp3DurationMs', () => {
  it('对 CBR MP3 按码率估算时长（误差在单帧时长内）', () => {
    const frames = 100;
    const ms = estimateMp3DurationMs(cbrMp3(frames));
    const expected = (frames * 1152 * 1000) / 44_100; // ≈ 2612ms
    expect(ms).not.toBeNull();
    expect(Math.abs((ms as number) - expected)).toBeLessThan(30);
  });

  it('优先用 Xing 头里的帧数，VBR 也准确', () => {
    const frames = 500;
    const ms = estimateMp3DurationMs(xingMp3(frames));
    expect(ms).toBe(Math.round((frames * 1152 * 1000) / 44_100));
  });

  it('能跳过 ID3v2 标签头', () => {
    const plain = cbrMp3(50);
    const tagged = withId3v2(plain);
    const a = estimateMp3DurationMs(plain);
    const b = estimateMp3DurationMs(tagged);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    // 剥掉标签后剩余数据相同，估算结果应一致（CBR 路径按剩余字节折算）
    expect(b).toBe(a);
  });

  it('非 MP3 / 空数据返回 null', () => {
    expect(estimateMp3DurationMs(Buffer.alloc(0))).toBeNull();
    expect(estimateMp3DurationMs(Buffer.from('not an mp3 at all'))).toBeNull();
  });
});
