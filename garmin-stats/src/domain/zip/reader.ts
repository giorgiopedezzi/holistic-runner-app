import { crc32, inflateRawSync } from "node:zlib";

const LOCAL_FILE_HEADER_SIG = 0x04034b50;
const CENTRAL_DIR_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const MAX_EOCD_COMMENT_BYTES = 0xffff;
const MAX_FIT_FILES = 14;

export interface ZipReadLimits {
  maxExpandedBytes: number;
  maxEntryBytes: number;
  maxEntries: number;
}

export interface FitZipEntry {
  filename: string;
  data: Buffer;
}

interface CentralEntry {
  filename: string;
  flags: number;
  compressionMethod: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export class FitZipValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FitZipValidationError";
  }
}

function invalid(message: string): never {
  throw new FitZipValidationError(message);
}

function findEocd(archive: Buffer): number {
  const firstCandidate = archive.length - 22;
  const lastCandidate = Math.max(0, firstCandidate - MAX_EOCD_COMMENT_BYTES);
  for (let offset = firstCandidate; offset >= lastCandidate; offset--) {
    if (archive.readUInt32LE(offset) === EOCD_SIG) return offset;
  }
  return invalid("The uploaded file is not a valid ZIP archive.");
}

function safeArchivePath(filename: string): string {
  if (filename.includes("\0")) return invalid("The ZIP contains an invalid entry name.");
  const normalized = filename.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
    return invalid("The ZIP contains an absolute entry path.");
  }
  if (normalized.split("/").some(segment => segment === "..")) {
    return invalid("The ZIP contains a path-traversal entry.");
  }
  return normalized;
}

function isHarmlessJunk(filename: string): boolean {
  const segments = filename.split("/");
  const basename = segments.at(-1) ?? "";
  return segments.includes("__MACOSX") || basename.startsWith("._") || basename === ".DS_Store" || basename === "Thumbs.db";
}

function readCentralEntries(archive: Buffer, limits: ZipReadLimits): { entries: CentralEntry[]; centralOffset: number } {
  if (archive.length < 22) return invalid("The uploaded file is not a valid ZIP archive.");
  const eocd = findEocd(archive);
  const commentLength = archive.readUInt16LE(eocd + 20);
  if (eocd + 22 + commentLength !== archive.length) return invalid("The ZIP end record is malformed.");

  const diskNumber = archive.readUInt16LE(eocd + 4);
  const centralDisk = archive.readUInt16LE(eocd + 6);
  const diskEntries = archive.readUInt16LE(eocd + 8);
  const totalEntries = archive.readUInt16LE(eocd + 10);
  const centralSize = archive.readUInt32LE(eocd + 12);
  const centralOffset = archive.readUInt32LE(eocd + 16);
  if (diskNumber !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) return invalid("Multi-disk ZIP archives are not supported.");
  if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) return invalid("ZIP64 archives are not supported.");
  if (totalEntries > limits.maxEntries) return invalid(`The ZIP contains more than ${limits.maxEntries} total entries.`);
  if (centralOffset + centralSize > eocd) return invalid("The ZIP central directory is malformed.");

  const entries: CentralEntry[] = [];
  let expandedBytes = 0;
  let offset = centralOffset;
  for (let index = 0; index < totalEntries; index++) {
    if (offset + 46 > eocd || archive.readUInt32LE(offset) !== CENTRAL_DIR_HEADER_SIG) return invalid("The ZIP central directory is malformed.");
    const flags = archive.readUInt16LE(offset + 8);
    const compressionMethod = archive.readUInt16LE(offset + 10);
    const crc = archive.readUInt32LE(offset + 16);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentBytes = archive.readUInt16LE(offset + 32);
    const localHeaderOffset = archive.readUInt32LE(offset + 42);
    const nextOffset = offset + 46 + nameLength + extraLength + commentBytes;
    if (nextOffset > eocd) return invalid("The ZIP central directory is malformed.");
    if ((flags & 0x41) !== 0) return invalid("Encrypted ZIP archives are not supported.");
    if ([compressedSize, uncompressedSize, localHeaderOffset].includes(0xffffffff)) return invalid("ZIP64 entries are not supported.");

    const filename = safeArchivePath(archive.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"));
    if (!filename.endsWith("/")) {
      expandedBytes += uncompressedSize;
      if (expandedBytes > limits.maxExpandedBytes) return invalid("The ZIP expands beyond the configured size limit.");
    }
    entries.push({ filename, flags, compressionMethod, crc, compressedSize, uncompressedSize, localHeaderOffset });
    offset = nextOffset;
  }
  if (offset !== centralOffset + centralSize) return invalid("The ZIP central directory size is inconsistent.");
  return { entries, centralOffset };
}

function extractEntry(archive: Buffer, centralOffset: number, entry: CentralEntry, limits: ZipReadLimits): Buffer {
  if (entry.uncompressedSize > limits.maxEntryBytes) return invalid(`FIT entry ${entry.filename} exceeds the configured per-file limit.`);
  const offset = entry.localHeaderOffset;
  if (offset + 30 > centralOffset || archive.readUInt32LE(offset) !== LOCAL_FILE_HEADER_SIG) return invalid("A ZIP local file header is malformed.");
  const localFlags = archive.readUInt16LE(offset + 6);
  const localMethod = archive.readUInt16LE(offset + 8);
  const nameLength = archive.readUInt16LE(offset + 26);
  const extraLength = archive.readUInt16LE(offset + 28);
  if (localFlags !== entry.flags || localMethod !== entry.compressionMethod) return invalid("A ZIP entry header is inconsistent.");
  const dataStart = offset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > centralOffset) return invalid("A ZIP entry exceeds the archive bounds.");
  const compressed = archive.subarray(dataStart, dataEnd);

  let data: Buffer;
  if (entry.compressionMethod === 0) {
    if (entry.compressedSize !== entry.uncompressedSize) return invalid("A stored ZIP entry has inconsistent sizes.");
    data = Buffer.from(compressed);
  } else if (entry.compressionMethod === 8) {
    try {
      data = inflateRawSync(compressed, { maxOutputLength: limits.maxEntryBytes });
    } catch {
      return invalid(`FIT entry ${entry.filename} could not be decompressed within the configured limit.`);
    }
  } else {
    return invalid(`FIT entry ${entry.filename} uses an unsupported compression method.`);
  }
  if (data.length !== entry.uncompressedSize || (crc32(data) >>> 0) !== entry.crc) {
    data.fill(0);
    return invalid(`FIT entry ${entry.filename} failed its ZIP integrity check.`);
  }
  return data;
}

export function readFitZip(archive: Buffer, limits: ZipReadLimits): FitZipEntry[] {
  const { entries, centralOffset } = readCentralEntries(archive, limits);
  const fitEntries = entries.filter(entry => {
    if (entry.filename.endsWith("/") || isHarmlessJunk(entry.filename)) return false;
    return entry.filename.toLowerCase().endsWith(".fit");
  });
  if (fitEntries.length === 0) return invalid("The ZIP must contain at least one .fit file.");
  if (fitEntries.length > MAX_FIT_FILES) return invalid("The ZIP contains more than 14 FIT files.");

  const extracted: FitZipEntry[] = [];
  try {
    for (const entry of fitEntries) {
      extracted.push({
        filename: entry.filename.split("/").at(-1)!,
        data: extractEntry(archive, centralOffset, entry, limits),
      });
    }
    return extracted;
  } catch (error) {
    for (const entry of extracted) entry.data.fill(0);
    throw error;
  }
}
