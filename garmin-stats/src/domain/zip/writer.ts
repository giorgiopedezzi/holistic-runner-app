// ── ZIP writer — pure transform ──────────────────────────────────────────────
// HRA-203: a minimal, zero-dependency STORE-format (uncompressed) ZIP writer —
// the Story's own explicit scope call ("no new npm package"). Pure bytes-in/
// bytes-out, no I/O, so it lives in domain/ rather than integrations/ (that
// folder is reserved for a real third-party wire-format boundary, currently
// only @garmin/fitsdk — see garmin-workout.ts's own header comment).
//
// Layout (PKZIP APPNOTE 6.3.x, STORE method only — no Zip64, no data
// descriptors, since every entry's size/CRC is known upfront):
//   [local file header + name + data]...  (one per entry, in order)
//   [central directory header + name]...  (one per entry, mirrors the above)
//   [end of central directory record]
// Central directory entries carry each local header's byte offset — get this
// wrong and the archive can still "look" fine in a lenient reader (one that
// walks local headers sequentially) while a strict one (which seeks via the
// central directory, as most do) reads garbage or refuses the file — the
// exact failure mode this Story's Risks section flags. Verified against a
// real external tool (`tar`, not this repo's own code) in
// test/domain/zip-writer.test.ts, not just round-tripped through this file.
import { crc32 } from "node:zlib";

export interface ZipEntry {
  // Flat filename — no directory separators; every consumer here writes a
  // single-level archive (one .fit per entry), so subdirectory support was
  // never needed and isn't implemented.
  name: string;
  data: Buffer;
  // Per-entry mtime stored in the archive (DOS date/time, 2-second
  // resolution — the format's own limit). Defaults to now; callers that want
  // deterministic output (mirroring HRA-184's toGarminWorkoutFit) pass the
  // day's own calendar date instead.
  date?: Date;
}

const LOCAL_FILE_HEADER_SIG = 0x04034b50;
const CENTRAL_DIR_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const VERSION_NEEDED = 20; // 2.0 — the baseline that covers STORE + long filenames
const UTF8_FLAG = 0x0800; // general-purpose bit 11: name/comment are UTF-8 (EFS)

function dosDateTime(d: Date): { time: number; date: number } {
  // DOS timestamps can't represent a year before 1980; clamp rather than
  // wrap/throw for the (practically unreachable) case of a pre-1980 date.
  const year = Math.max(1980, d.getFullYear());
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

// Every multi-byte field in a ZIP header is little-endian (APPNOTE §4.1.4).
export function writeZip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data) >>> 0; // node:zlib returns a signed int32; force unsigned
    const size = entry.data.length;
    const { time, date } = dosDateTime(entry.date ?? new Date());

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(LOCAL_FILE_HEADER_SIG, 0);
    localHeader.writeUInt16LE(VERSION_NEEDED, 4);
    localHeader.writeUInt16LE(UTF8_FLAG, 6);
    localHeader.writeUInt16LE(0, 8); // compression method: 0 = STORE
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(size, 18); // compressed size == uncompressed (STORE)
    localHeader.writeUInt32LE(size, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra field length
    localParts.push(localHeader, nameBuf, entry.data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(CENTRAL_DIR_HEADER_SIG, 0);
    centralHeader.writeUInt16LE(VERSION_NEEDED, 4); // version made by
    centralHeader.writeUInt16LE(VERSION_NEEDED, 6); // version needed to extract
    centralHeader.writeUInt16LE(UTF8_FLAG, 8);
    centralHeader.writeUInt16LE(0, 10); // compression method
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(date, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(size, 20);
    centralHeader.writeUInt32LE(size, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra field length
    centralHeader.writeUInt16LE(0, 32); // file comment length
    centralHeader.writeUInt16LE(0, 34); // disk number start
    centralHeader.writeUInt16LE(0, 36); // internal file attributes
    centralHeader.writeUInt32LE(0, 38); // external file attributes
    centralHeader.writeUInt32LE(offset, 42); // this entry's local header offset
    centralParts.push(centralHeader, nameBuf);

    offset += localHeader.length + nameBuf.length + entry.data.length;
  }

  const centralDirOffset = offset;
  const centralDirSize = centralParts.reduce((sum, b) => sum + b.length, 0);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4); // this disk's number
  eocd.writeUInt16LE(0, 6); // disk where central directory starts
  eocd.writeUInt16LE(entries.length, 8); // central-dir records on this disk
  eocd.writeUInt16LE(entries.length, 10); // total central-dir records
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(centralDirOffset, 16);
  eocd.writeUInt16LE(0, 20); // archive comment length

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

// Guards against two entries in the same batch sharing a filename (e.g. two
// resolved days landing on the same calendar date via a suffix, see
// docs/schema.md's plan_instance_days.suffix) — silently letting that through
// would produce a technically-valid ZIP where one workout's .fit clobbers
// another's on extract. Appends "-2", "-3", ... before the extension on
// every collision after the first.
export function dedupeZipEntryNames<T extends { name: string }>(entries: T[]): T[] {
  const seen = new Map<string, number>();
  return entries.map(entry => {
    const count = seen.get(entry.name) ?? 0;
    seen.set(entry.name, count + 1);
    if (count === 0) return entry;
    const dot = entry.name.lastIndexOf(".");
    const stem = dot === -1 ? entry.name : entry.name.slice(0, dot);
    const ext = dot === -1 ? "" : entry.name.slice(dot);
    return { ...entry, name: `${stem}-${count + 1}${ext}` };
  });
}
