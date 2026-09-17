import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32, deflateRawSync } from "node:zlib";
import { readFitZip, FitZipValidationError } from "../../src/domain/zip/reader.ts";
import { writeZip } from "../../src/domain/zip/writer.ts";

const LIMITS = { maxExpandedBytes: 1024 * 1024, maxEntryBytes: 512 * 1024, maxEntries: 32 };

function oneDeflatedEntry(name: string, data: Buffer): Buffer {
  const nameBytes = Buffer.from(name);
  const compressed = deflateRawSync(data);
  const checksum = crc32(data) >>> 0;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);

  const centralOffset = local.length + nameBytes.length + compressed.length;
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + nameBytes.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, nameBytes, compressed, central, nameBytes, eocd]);
}

test("FIT ZIP reader accepts STORE/DEFLATE, nested safe names, and ignores non-FIT junk", () => {
  const stored = writeZip([
    { name: "safe/run.fit", data: Buffer.from("fit-one") },
    { name: "__MACOSX/._run.fit", data: Buffer.from("junk") },
    { name: "notes.txt", data: Buffer.from("ignore") },
  ]);
  const entries = readFitZip(stored, LIMITS);
  assert.deepEqual(entries.map(entry => entry.filename), ["run.fit"]);
  assert.equal(entries[0]!.data.toString(), "fit-one");

  const deflated = readFitZip(oneDeflatedEntry("compressed.fit", Buffer.from("deflated-fit")), LIMITS);
  assert.equal(deflated[0]!.data.toString(), "deflated-fit");
});

test("FIT ZIP reader accepts 14 FIT entries and rejects 15 before extraction", () => {
  const fourteen = writeZip(Array.from({ length: 14 }, (_, index) => ({ name: `${index}.fit`, data: Buffer.from([index]) })));
  assert.equal(readFitZip(fourteen, LIMITS).length, 14);
  const fifteen = writeZip(Array.from({ length: 15 }, (_, index) => ({ name: `${index}.fit`, data: Buffer.from([index]) })));
  assert.throws(() => readFitZip(fifteen, LIMITS), /more than 14 FIT files/);
});

test("FIT ZIP reader rejects traversal, encrypted entries, and expanded-size overflow", () => {
  assert.throws(
    () => readFitZip(writeZip([{ name: "../escape.fit", data: Buffer.from("x") }]), LIMITS),
    (error: unknown) => error instanceof FitZipValidationError && /path-traversal/.test(error.message),
  );

  const encrypted = writeZip([{ name: "secret.fit", data: Buffer.from("x") }]);
  encrypted.writeUInt16LE(encrypted.readUInt16LE(6) | 1, 6);
  const central = encrypted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  encrypted.writeUInt16LE(encrypted.readUInt16LE(central + 8) | 1, central + 8);
  assert.throws(() => readFitZip(encrypted, LIMITS), /Encrypted ZIP archives/);

  const oversized = writeZip([{ name: "large.fit", data: Buffer.alloc(64) }]);
  assert.throws(() => readFitZip(oversized, { ...LIMITS, maxExpandedBytes: 32 }), /expands beyond/);
});
