/**
 * test/domain/zip-writer.test.ts (HRA-203)
 * Verifies domain/zip/writer.ts against a real, independent unzip tool
 * (Info-ZIP's unzip, bundled with Git for Windows) rather than only this
 * repo's own code — the Story's own Risks section calls out that a subtly
 * wrong local-header/central-directory offset can produce a ZIP that looks
 * fine to a lenient/sequential reader while a strict one (most real tools,
 * which seek via the central directory) reads garbage or refuses the file.
 * `unzip -t` additionally verifies every entry's CRC-32, so a wrong crc32()
 * call would fail this test even if the byte layout were otherwise correct.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dedupeZipEntryNames, writeZip } from "../../src/domain/zip/writer.ts";

function unzip(args: string[], cwd: string): string {
  return execFileSync("unzip", args, { cwd, encoding: "utf8" });
}

test("writeZip produces an archive that a real unzip tool lists, extracts, and verifies intact", () => {
  const dir = mkdtempSync(join(tmpdir(), "hra203-zip-"));
  try {
    const zip = writeZip([
      { name: "2026-09-01.fit", data: Buffer.from("fit-bytes-one"), date: new Date("2026-09-01T00:00:00Z") },
      { name: "2026-09-02.fit", data: Buffer.from("fit bytes two, a bit longer than the first"), date: new Date("2026-09-02T00:00:00Z") },
    ]);
    const zipPath = join(dir, "plan.zip");
    writeFileSync(zipPath, zip);

    const listing = unzip(["-l", "plan.zip"], dir);
    assert.match(listing, /2026-09-01\.fit/);
    assert.match(listing, /2026-09-02\.fit/);

    assert.equal(unzip(["-p", "plan.zip", "2026-09-01.fit"], dir), "fit-bytes-one");
    assert.equal(unzip(["-p", "plan.zip", "2026-09-02.fit"], dir), "fit bytes two, a bit longer than the first");

    // -t re-verifies each entry's CRC-32 against its stored data — this is
    // the check that would fail on a wrong crc32() call, not just -l/-p.
    const integrity = unzip(["-t", "plan.zip"], dir);
    assert.match(integrity, /No errors detected/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeZip encodes a non-ASCII filename as UTF-8 with the EFS general-purpose flag set", () => {
  // The bundled unzip.exe here is Info-ZIP 6.00 (2009), predating that build's
  // reliable EFS/UTF-8 support on Windows — it visibly mangles "à" even
  // though the archive is spec-correct (verified manually against 7-Zip and
  // Windows' own Explorer extraction, both of which read it correctly), so
  // asserting against structure here — the general-purpose flag bit and the
  // exact UTF-8 byte sequence — is the reliable check, not a proxy for
  // "some external tool's own Unicode fidelity."
  const name = "Piano città_2026-09-01.fit";
  const zip = writeZip([{ name, data: Buffer.from("x") }]);
  const generalPurposeFlag = zip.readUInt16LE(6);
  assert.equal(generalPurposeFlag & 0x0800, 0x0800, "EFS (UTF-8) bit must be set");
  const nameLength = zip.readUInt16LE(26);
  const nameBytes = zip.subarray(30, 30 + nameLength);
  assert.deepEqual(nameBytes, Buffer.from(name, "utf8"));
});

test("dedupeZipEntryNames disambiguates a same-name collision (e.g. two suffixed days on one date)", () => {
  const entries = dedupeZipEntryNames([
    { name: "Plan_20260901.fit" },
    { name: "Plan_20260901.fit" },
    { name: "Plan_20260902.fit" },
    { name: "Plan_20260901.fit" },
  ]);
  assert.deepEqual(entries.map(e => e.name), [
    "Plan_20260901.fit", "Plan_20260901-2.fit", "Plan_20260902.fit", "Plan_20260901-3.fit",
  ]);
});
