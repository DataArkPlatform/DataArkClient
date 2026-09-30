/**
 * zstd 拼接帧解压基建 —— DeepSeek Harness 会话日志为「checksummed 拼接 Zstandard 帧」。
 *
 * Node 的 zlib.zstdDecompressSync / createZstdDecompress 只解**首帧**并忽略后续，
 * 因此需先按帧边界扫描（纯结构解析，不依赖第三方 zstd 库），再逐帧解压拼接。
 * 截断的尾帧（进程崩溃）直接丢弃，返回已完整解压的前缀。
 */
import { zstdDecompressSync } from 'node:zlib'

/** zstd 帧魔数（小端 0xFD2FB528） */
const ZSTD_MAGIC = 0xfd2fb528

/**
 * 计算 off 处一个完整 zstd 帧的字节长度；数据不足或非法返回 undefined。
 * 结构：Magic(4) + Frame_Header(描述符/窗口/字典ID/内容大小) + Data_Blocks + [Checksum(4)]
 */
function frameLength(buf: Buffer, off: number): number | undefined {
  if (off + 4 > buf.length || buf.readUInt32LE(off) !== ZSTD_MAGIC) return undefined
  let p = off + 4
  if (p >= buf.length) return undefined
  const descriptor = buf[p]!
  p += 1
  const fcsFlag = (descriptor >> 6) & 0x3
  const singleSegment = (descriptor >> 5) & 0x1
  const hasChecksum = (descriptor >> 2) & 0x1
  const dictIdFlag = descriptor & 0x3
  if (singleSegment === 0) p += 1 // Window_Descriptor
  p += dictIdFlag === 0 ? 0 : dictIdFlag === 1 ? 1 : dictIdFlag === 2 ? 2 : 4
  p += fcsFlag === 0 ? (singleSegment === 1 ? 1 : 0) : fcsFlag === 1 ? 2 : fcsFlag === 2 ? 4 : 8
  for (;;) {
    if (p + 3 > buf.length) return undefined
    const blockHeader = buf.readUInt32LE(p) & 0xffffff
    p += 3
    const last = blockHeader & 0x1
    const blockType = (blockHeader >> 1) & 0x3
    const blockSize = blockHeader >> 3
    if (blockType === 3) return undefined // Reserved
    p += blockType === 1 ? 1 : blockSize // RLE 块仅 1 字节；Raw/Compressed 为 blockSize
    if (p > buf.length) return undefined
    if (last === 1) break
  }
  if (hasChecksum === 1) p += 4
  return p > buf.length ? undefined : p - off
}

/** 解压拼接的 zstd 帧序列 → UTF-8 文本；截断尾帧丢弃 */
export function decompressZstdFrames(buf: Buffer): string {
  const parts: Buffer[] = []
  let off = 0
  while (off < buf.length) {
    const len = frameLength(buf, off)
    if (len === undefined) break
    parts.push(zstdDecompressSync(buf.subarray(off, off + len)))
    off += len
  }
  return Buffer.concat(parts).toString('utf8')
}
