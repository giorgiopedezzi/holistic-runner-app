/**
 * test/domain/source-extraction.test.ts (HRA-327)
 * Exercises every distinct rejection reason the Story's acceptance criteria
 * name, plus the two success paths (.txt/.csv round-trip, genuine PDF ->
 * text + pageCount), directly against the pure domain transform.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractSourceFile, MAX_SOURCE_FILE_BYTES, MAX_PDF_PAGES,
} from "../../src/domain/source-extraction.ts";
import { buildTextPdf, buildImageOnlyPdf, buildEncryptedPdf } from "../helpers/pdf-fixtures.ts";

function b64(buf: Buffer): string {
  return buf.toString("base64");
}

test(".txt content round-trips unchanged apart from line-ending normalization", async () => {
  const raw = Buffer.from("Week 1\r\nDay 1: easy 5k\rDay 2: rest\n", "utf-8");
  const outcome = await extractSourceFile({ fileName: "plan.txt", sourceType: "txt", contentBase64: b64(raw) });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.result.sourceText, "Week 1\nDay 1: easy 5k\nDay 2: rest\n");
  assert.equal(outcome.result.sourceType, "txt");
  assert.equal(outcome.result.fileName, "plan.txt");
  assert.equal(outcome.result.pageCount, undefined);
});

test(".csv content round-trips unchanged apart from line-ending normalization", async () => {
  const raw = Buffer.from("day,distance_km\r\n1,5\r\n2,0\r\n", "utf-8");
  const outcome = await extractSourceFile({ fileName: "plan.csv", sourceType: "csv", contentBase64: b64(raw) });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.result.sourceText, "day,distance_km\n1,5\n2,0\n");
  assert.equal(outcome.result.sourceType, "csv");
});

test("a genuine text-based PDF returns extracted text and a pageCount", async () => {
  const pdf = buildTextPdf(["Week 1: easy 5k", "Week 2: tempo 8k"]);
  const outcome = await extractSourceFile({ fileName: "plan.pdf", sourceType: "pdf", contentBase64: b64(pdf) });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.result.sourceType, "pdf");
  assert.equal(outcome.result.pageCount, 2);
  assert.match(outcome.result.sourceText, /Week 1: easy 5k/);
  assert.match(outcome.result.sourceText, /Week 2: tempo 8k/);
});

test("a PDF is extracted as one even when declared txt/csv (sniffs real content type)", async () => {
  const pdf = buildTextPdf(["Sniffed as PDF"]);
  const outcome = await extractSourceFile({ fileName: "plan.txt", sourceType: "txt", contentBase64: b64(pdf) });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.result.sourceType, "pdf");
  assert.equal(outcome.result.pageCount, 1);
});

test("an encrypted PDF is rejected with a distinct, actionable reason", async () => {
  const pdf = buildEncryptedPdf();
  const outcome = await extractSourceFile({ fileName: "locked.pdf", sourceType: "pdf", contentBase64: b64(pdf) });
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.error.code, "ENCRYPTED_PDF");
});

test("a corrupt/non-PDF file misnamed .pdf is rejected with a distinct, actionable reason", async () => {
  const garbage = Buffer.from("this is definitely not a pdf file at all", "utf-8");
  const outcome = await extractSourceFile({ fileName: "fake.pdf", sourceType: "pdf", contentBase64: b64(garbage) });
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.error.code, "INVALID_PDF");
});

test("an image-only (no extractable text) PDF is rejected with a distinct, actionable reason", async () => {
  const pdf = buildImageOnlyPdf();
  const outcome = await extractSourceFile({ fileName: "scanned.pdf", sourceType: "pdf", contentBase64: b64(pdf) });
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.error.code, "IMAGE_ONLY_PDF");
});

test("an oversized file is rejected, distinct from every content-based reason", async () => {
  const big = Buffer.alloc(MAX_SOURCE_FILE_BYTES + 1, "a".charCodeAt(0));
  const outcome = await extractSourceFile({ fileName: "big.txt", sourceType: "txt", contentBase64: b64(big) });
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.error.code, "FILE_TOO_LARGE");
});

test("a PDF exceeding the page-count limit is rejected before extraction", async () => {
  const pages = Array.from({ length: MAX_PDF_PAGES + 1 }, (_, i) => `Page ${i}`);
  const pdf = buildTextPdf(pages);
  const outcome = await extractSourceFile({ fileName: "huge.pdf", sourceType: "pdf", contentBase64: b64(pdf) });
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.error.code, "TOO_MANY_PAGES");
});

test("an empty extraction is never treated as a valid plan", async () => {
  const empty = Buffer.from("   \n\r\n  ", "utf-8");
  const outcome = await extractSourceFile({ fileName: "empty.txt", sourceType: "txt", contentBase64: b64(empty) });
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.error.code, "EMPTY_EXTRACTION");
});

test("a zero-byte decoded file is rejected as an empty extraction", async () => {
  const outcome = await extractSourceFile({ fileName: "nothing.txt", sourceType: "txt", contentBase64: "" });
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.error.code, "EMPTY_EXTRACTION");
});
