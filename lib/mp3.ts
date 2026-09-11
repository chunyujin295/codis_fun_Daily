/**
 * 轻量 MP3 时长估算（不引入解码库）。
 *
 * 思路：跳过 ID3v2 标签后解析首帧 MPEG 头，得到码率 / 采样率 / 每帧采样数；
 * 若文件带 Xing/Info 头则用「总帧数」精确换算（VBR 同样成立），否则按 CBR
 * 用「剩余字节 × 8 / 码率」估算。返回毫秒；无法解析（非 MP3、free 码率、
 * 结构异常）返回 null，调用方自行降级。
 */
export function estimateMp3DurationMs(bytes: Buffer): number | null {
  const len = bytes.length;
  if (len < 4) return null;

  // 跳过 ID3v2 标签（size 字段是 syncsafe 编码，位于第 6~9 字节）
  let audioStart = 0;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const tagSize =
      ((bytes[6] & 0x7f) << 21) |
      ((bytes[7] & 0x7f) << 14) |
      ((bytes[8] & 0x7f) << 7) |
      (bytes[9] & 0x7f);
    const hasFooter = (bytes[5] & 0x10) !== 0;
    audioStart = 10 + tagSize + (hasFooter ? 10 : 0);
    if (audioStart + 4 > len) return null;
  }

  const b0 = bytes[audioStart];
  const b1 = bytes[audioStart + 1];
  const b2 = bytes[audioStart + 2];
  if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) return null;

  const versionBits = (b1 >> 3) & 0x03; // 11=MPEG1, 10=MPEG2, 00=MPEG2.5
  const layerBits = (b1 >> 1) & 0x03; // 01=Layer III
  const bitrateIdx = (b2 >> 4) & 0x0f;
  const sampleRateIdx = (b2 >> 2) & 0x03;
  if (layerBits !== 0x01 || bitrateIdx === 0 || bitrateIdx === 15) return null;

  let bitrateKbps: number;
  let sampleRateHz: number;
  let samplesPerFrame: number;
  if (versionBits === 0x03) {
    const BITRATES = [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
    const SAMPLE_RATES = [44100, 48000, 32000];
    bitrateKbps = BITRATES[bitrateIdx - 1];
    sampleRateHz = SAMPLE_RATES[sampleRateIdx] ?? 0;
    samplesPerFrame = 1152;
  } else {
    const BITRATES = [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
    const rates =
      versionBits === 0x02
        ? [22050, 24000, 16000] // MPEG2
        : [11025, 12000, 8000]; // MPEG2.5
    bitrateKbps = BITRATES[bitrateIdx - 1];
    sampleRateHz = rates[sampleRateIdx] ?? 0;
    samplesPerFrame = 576;
  }
  if (!sampleRateHz) return null;

  // Xing / Info 头：取到总帧数，时长最准
  const sideInfoLen = versionBits === 0x03 ? 32 : 17;
  const xingOffset = audioStart + 4 + sideInfoLen;
  const isXingOrInfo =
    xingOffset + 12 <= len &&
    (bytes[xingOffset] === 0x58 || bytes[xingOffset] === 0x49) &&
    bytes[xingOffset + 1] === 0x69 &&
    bytes[xingOffset + 2] === 0x6e &&
    bytes[xingOffset + 3] === 0x67;
  if (isXingOrInfo) {
    const frames =
      (bytes[xingOffset + 8] << 24) |
      (bytes[xingOffset + 9] << 16) |
      (bytes[xingOffset + 10] << 8) |
      bytes[xingOffset + 11];
    if (frames > 0) {
      return Math.max(1, Math.round((frames * samplesPerFrame * 1000) / sampleRateHz));
    }
  }

  // CBR 估算：剩余字节按首帧码率折算
  const totalMs = ((len - audioStart) * 8 * 1000) / (bitrateKbps * 1000);
  return Math.max(1, Math.round(totalMs));
}
