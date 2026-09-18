import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { writeZip } from "../../src/domain/zip/writer.ts";
import { createFitImportService } from "../../src/services/fit-import.service.ts";
import { FOUNDER_USER_ID } from "../../src/db/founder.ts";
import { startTestServer } from "../helpers/server.ts";

const referenceFit = readFileSync(fileURLToPath(new URL("../../fit-archive/2026-08-04-10-28-43.fit", import.meta.url)));
const OPTIONS = { maxExpandedBytes: 50 * 1024 * 1024, maxEntryBytes: 10 * 1024 * 1024, maxEntries: 256, parseConcurrency: 2 };

async function upload(server: Awaited<ReturnType<typeof startTestServer>>, zip: Buffer) {
  return server.api("/api/v1/imports/fit-zip", {
    method: "POST",
    headers: { "Content-Type": "application/zip" },
    body: zip as unknown as RequestInit["body"],
  });
}

test("authenticated ZIP import handles one and fourteen FIT files", async () => {
  const oneServer = await startTestServer();
  try {
    const one = await upload(oneServer, writeZip([{ name: "one.fit", data: referenceFit }]));
    assert.equal(one.status, 200);
    assert.deepEqual((one.json as { summary: unknown }).summary, { imported: 1, duplicates: 0, failed: 0 });
  } finally { await oneServer.close(); }

  const fourteenServer = await startTestServer();
  try {
    const fourteen = await upload(fourteenServer, writeZip(Array.from({ length: 14 }, (_, index) => ({ name: `run-${index}.fit`, data: referenceFit }))));
    assert.equal(fourteen.status, 200);
    assert.deepEqual((fourteen.json as { summary: unknown }).summary, { imported: 14, duplicates: 0, failed: 0 });
    assert.equal((await fourteenServer.db.get<{ count: number }>("SELECT COUNT(*)::int AS count FROM activities WHERE user_id=$1", [FOUNDER_USER_ID]))?.count, 14);
  } finally { await fourteenServer.close(); }
});

test("fifteen FIT files and unsafe archives are rejected before any import starts", async () => {
  const server = await startTestServer();
  try {
    const fifteen = await upload(server, writeZip(Array.from({ length: 15 }, (_, index) => ({ name: `run-${index}.fit`, data: referenceFit }))));
    assert.equal(fifteen.status, 422);
    assert.equal((await server.db.get<{ count: number }>("SELECT COUNT(*)::int AS count FROM activities WHERE user_id=$1", [FOUNDER_USER_ID]))?.count, 0);

    const traversal = await upload(server, writeZip([{ name: "../escape.fit", data: referenceFit }]));
    assert.equal(traversal.status, 422);
    const encrypted = writeZip([{ name: "secret.fit", data: referenceFit }]);
    encrypted.writeUInt16LE(encrypted.readUInt16LE(6) | 1, 6);
    const central = encrypted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    encrypted.writeUInt16LE(encrypted.readUInt16LE(central + 8) | 1, central + 8);
    assert.equal((await upload(server, encrypted)).status, 422);
  } finally { await server.close(); }
});

test("mixed duplicate, valid, and malformed FIT files return partial success without rollback", async () => {
  const server = await startTestServer();
  try {
    const service = createFitImportService(server.db);
    assert.equal((await service.importOne(FOUNDER_USER_ID, "duplicate.fit", referenceFit)).status, "imported");
    const response = await upload(server, writeZip([
      { name: "duplicate.fit", data: referenceFit },
      { name: "valid.fit", data: referenceFit },
      { name: "malformed.fit", data: Buffer.from("not a FIT file") },
    ]));
    assert.equal(response.status, 200);
    const payload = response.json as { results: { filename: string; status: string; reason?: string }[]; summary: unknown };
    assert.deepEqual(payload.results.map(result => [result.filename, result.status]), [
      ["duplicate.fit", "duplicate"], ["valid.fit", "imported"], ["malformed.fit", "failed"],
    ]);
    assert.match(payload.results[2]!.reason ?? "", /FIT|fit|buffer|header/);
    assert.deepEqual(payload.summary, { imported: 1, duplicates: 1, failed: 1 });
    assert.equal((await server.db.get<{ count: number }>("SELECT COUNT(*)::int AS count FROM activities WHERE user_id=$1", [FOUNDER_USER_ID]))?.count, 2);
  } finally { await server.close(); }
});

test("single-FIT import remains idempotent and archive bytes are cleared on success and validation failure", async () => {
  const server = await startTestServer();
  try {
    const service = createFitImportService(server.db);
    assert.equal((await service.importOne(FOUNDER_USER_ID, "single.fit", referenceFit)).status, "imported");
    const trackCount = (await server.db.get<{ count: number }>("SELECT COUNT(*)::int AS count FROM track_points"))!.count;
    assert.equal((await service.importOne(FOUNDER_USER_ID, "single.fit", referenceFit)).status, "duplicate");
    assert.equal((await server.db.get<{ count: number }>("SELECT COUNT(*)::int AS count FROM track_points"))!.count, trackCount);

    const successArchive = writeZip([{ name: "cleared.fit", data: referenceFit }]);
    await service.importArchive(FOUNDER_USER_ID, successArchive, OPTIONS);
    assert.ok(successArchive.every(byte => byte === 0));
    const parserErrorArchive = writeZip([{ name: "broken.fit", data: Buffer.from("not a FIT file") }]);
    const parserError = await service.importArchive(FOUNDER_USER_ID, parserErrorArchive, OPTIONS);
    assert.equal(parserError.results[0]!.status, "failed");
    assert.ok(parserErrorArchive.every(byte => byte === 0));
    const rejectedArchive = writeZip([{ name: "../escape.fit", data: referenceFit }]);
    await assert.rejects(() => service.importArchive(FOUNDER_USER_ID, rejectedArchive, OPTIONS));
    assert.ok(rejectedArchive.every(byte => byte === 0));
  } finally { await server.close(); }
});

test("a successfully imported running FIT has system_classification populated before the transaction completes (HRA-394)", async () => {
  const server = await startTestServer();
  try {
    const service = createFitImportService(server.db);
    const result = await service.importOne(FOUNDER_USER_ID, "classified.fit", referenceFit);
    assert.equal(result.status, "imported");
    const row = await server.db.get<{ sport: string; system_classification: string | null }>(
      "SELECT sport,system_classification FROM activities WHERE user_id=$1 AND filename=$2", [FOUNDER_USER_ID, "classified.fit"],
    );
    assert.equal(row?.sport, "running");
    assert.ok(row?.system_classification, "expected system_classification to be populated at ingestion, not left null");
  } finally { await server.close(); }
});

test("FIT ZIP import is unavailable without authentication", async () => {
  const server = await startTestServer();
  try {
    const response = await fetch(server.baseUrl + "/api/v1/imports/fit-zip", {
      method: "POST", headers: { "Content-Type": "application/zip", origin: "http://test.invalid" }, body: writeZip([{ name: "guest.fit", data: referenceFit }]),
    });
    assert.equal(response.status, 401);
    assert.equal((await server.db.get<{ count: number }>("SELECT COUNT(*)::int AS count FROM activities WHERE user_id=$1", [FOUNDER_USER_ID]))?.count, 0);
  } finally { await server.close(); }
});
