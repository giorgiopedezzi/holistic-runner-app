/**
 * test/http/source-files-extract.test.ts (HRA-327)
 * POST /api/v1/source-files/extract — HTTP-boundary coverage over the
 * domain unit tests in test/domain/source-extraction.test.ts: request
 * validation, status-code mapping (413 vs 422), and the success envelope.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "../helpers/server.ts";
import { buildTextPdf, buildEncryptedPdf } from "../helpers/pdf-fixtures.ts";

function b64(buf: Buffer): string {
  return buf.toString("base64");
}

async function post(server: Awaited<ReturnType<typeof startTestServer>>, body: unknown) {
  return server.api("/api/v1/source-files/extract", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

test("POST /api/v1/source-files/extract: .txt round-trips as sourceText", async () => {
  const server = await startTestServer();
  try {
    const raw = Buffer.from("Week 1\r\nDay 1: easy 5k\r\n", "utf-8");
    const res = await post(server, { fileName: "plan.txt", sourceType: "txt", contentBase64: b64(raw) });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.deepEqual(res.json, {
      sourceText: "Week 1\nDay 1: easy 5k\n", sourceType: "txt", fileName: "plan.txt",
    });
  } finally {
    await server.close();
  }
});

test("POST /api/v1/source-files/extract: a genuine PDF returns sourceText + pageCount", async () => {
  const server = await startTestServer();
  try {
    const pdf = buildTextPdf(["Week 1: easy 5k"]);
    const res = await post(server, { fileName: "plan.pdf", sourceType: "pdf", contentBase64: b64(pdf) });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const json = res.json as { sourceText: string; sourceType: string; fileName: string; pageCount: number };
    assert.equal(json.sourceType, "pdf");
    assert.equal(json.pageCount, 1);
    assert.match(json.sourceText, /Week 1: easy 5k/);
  } finally {
    await server.close();
  }
});

test("POST /api/v1/source-files/extract: an encrypted PDF 422s with an actionable detail", async () => {
  const server = await startTestServer();
  try {
    const pdf = buildEncryptedPdf();
    const res = await post(server, { fileName: "locked.pdf", sourceType: "pdf", contentBase64: b64(pdf) });
    assert.equal(res.status, 422, JSON.stringify(res.json));
    const json = res.json as { detail: string; errors: { field: string; message: string }[] };
    assert.match(json.detail, /password-protected|encrypted/i);
    assert.equal(json.errors[0].message, "ENCRYPTED_PDF");
  } finally {
    await server.close();
  }
});

test("POST /api/v1/source-files/extract: a corrupt file misnamed .pdf 422s", async () => {
  const server = await startTestServer();
  try {
    const garbage = Buffer.from("not a pdf", "utf-8");
    const res = await post(server, { fileName: "fake.pdf", sourceType: "pdf", contentBase64: b64(garbage) });
    assert.equal(res.status, 422, JSON.stringify(res.json));
    const json = res.json as { errors: { field: string; message: string }[] };
    assert.equal(json.errors[0].message, "INVALID_PDF");
  } finally {
    await server.close();
  }
});

test("POST /api/v1/source-files/extract: an oversized file 413s", async () => {
  const server = await startTestServer();
  try {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, "a".charCodeAt(0));
    const res = await post(server, { fileName: "big.txt", sourceType: "txt", contentBase64: b64(big) });
    assert.equal(res.status, 413, JSON.stringify(res.json));
    const json = res.json as { errors: { field: string; message: string }[] };
    assert.equal(json.errors[0].message, "FILE_TOO_LARGE");
  } finally {
    await server.close();
  }
});

test("POST /api/v1/source-files/extract: an empty extraction 422s, never returned as an empty string", async () => {
  const server = await startTestServer();
  try {
    const res = await post(server, { fileName: "empty.txt", sourceType: "txt", contentBase64: b64(Buffer.from("   \n  ")) });
    assert.equal(res.status, 422, JSON.stringify(res.json));
    const json = res.json as { errors: { field: string; message: string }[] };
    assert.equal(json.errors[0].message, "EMPTY_EXTRACTION");
  } finally {
    await server.close();
  }
});

test("POST /api/v1/source-files/extract: 422s on missing/invalid required fields", async () => {
  const server = await startTestServer();
  try {
    const noFileName = await post(server, { sourceType: "txt", contentBase64: b64(Buffer.from("x")) });
    assert.equal(noFileName.status, 422);

    const badSourceType = await post(server, { fileName: "a.bin", sourceType: "exe", contentBase64: b64(Buffer.from("x")) });
    assert.equal(badSourceType.status, 422);

    const noContent = await post(server, { fileName: "a.txt", sourceType: "txt" });
    assert.equal(noContent.status, 422);
  } finally {
    await server.close();
  }
});
