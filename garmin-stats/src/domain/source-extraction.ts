/**
 * domain/source-extraction.ts (HRA-327)
 * Pure transform: decoded file bytes -> plain-text plan source, or a distinct
 * rejection reason. Sniffs the real content type from the bytes themselves
 * (a PDF signature within pdf.js's own leading-bytes search window) rather
 * than trusting the caller's declared sourceType or the filename extension —
 * a file declared "pdf" that isn't one is corrupt/misnamed, never silently
 * reinterpreted as text; a file NOT declared "pdf" that actually is one is
 * still extracted as a PDF. No I/O, no persistence: everything here operates
 * on an in-memory buffer only.
 */
import { getDocumentProxy, extractText } from "unpdf";
import { PasswordException } from "unpdf/pdfjs";

export const SOURCE_TYPES = ["txt", "csv", "pdf"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export type SourceExtractionErrorCode =
  | "FILE_TOO_LARGE"
  | "TOO_MANY_PAGES"
  | "ENCRYPTED_PDF"
  | "INVALID_PDF"
  | "IMAGE_ONLY_PDF"
  | "EMPTY_EXTRACTION"
  | "INVALID_TEXT_ENCODING";

export interface SourceExtractionError {
  code: SourceExtractionErrorCode;
  message: string;
}

export interface SourceExtractionResult {
  sourceText: string;
  sourceType: SourceType;
  fileName: string;
  pageCount?: number;
}

export type SourceExtractionOutcome =
  | { ok: true; result: SourceExtractionResult }
  | { ok: false; error: SourceExtractionError };

// Matches the existing background-image upload limit (settings.controller.ts)
// — the one other raw-bytes-in-a-request-body precedent in this codebase.
export const MAX_SOURCE_FILE_BYTES = 10 * 1024 * 1024;
// A generous cap on a training-plan source document; guards against an
// adversarial/degenerate PDF forcing the parser through thousands of pages
// before any content check happens.
export const MAX_PDF_PAGES = 200;

const PDF_SIGNATURE = "%PDF-";
// pdf.js itself tolerates leading garbage before the signature and searches
// up to this many bytes for it — mirrored here so our own sniff agrees with
// what the parser would actually accept.
const PDF_SIGNATURE_SEARCH_WINDOW = 1024;

function looksLikePdf(buffer: Buffer): boolean {
  return buffer.subarray(0, PDF_SIGNATURE_SEARCH_WINDOW).includes(PDF_SIGNATURE);
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function formatMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

async function extractPdf(buffer: Buffer, fileName: string): Promise<SourceExtractionOutcome> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;
  try {
    pdf = await getDocumentProxy(new Uint8Array(buffer));

    if (pdf.numPages > MAX_PDF_PAGES) {
      return {
        ok: false,
        error: { code: "TOO_MANY_PAGES", message: `PDF has ${pdf.numPages} pages, exceeding the ${MAX_PDF_PAGES}-page limit.` },
      };
    }

    const { text } = await extractText(pdf, { mergePages: true });
    const normalized = normalizeLineEndings(text as string);
    if (!normalized.trim()) {
      return {
        ok: false,
        error: {
          code: "IMAGE_ONLY_PDF",
          message: "No extractable text found in this PDF — it may be a scanned or image-only document (OCR is not supported).",
        },
      };
    }

    return { ok: true, result: { sourceText: normalized, sourceType: "pdf", fileName, pageCount: pdf.numPages } };
  } catch (err) {
    if (err instanceof PasswordException) {
      return { ok: false, error: { code: "ENCRYPTED_PDF", message: "PDF is password-protected; encrypted PDFs are not supported." } };
    }
    return { ok: false, error: { code: "INVALID_PDF", message: "File does not appear to be a valid PDF — it may be corrupt or misnamed." } };
  } finally {
    if (pdf) await pdf.loadingTask.destroy().catch(() => {});
  }
}

function extractPlainText(buffer: Buffer, fileName: string, sourceType: SourceType): SourceExtractionOutcome {
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return { ok: false, error: { code: "INVALID_TEXT_ENCODING", message: "File content is not valid UTF-8 text." } };
  }
  const normalized = normalizeLineEndings(raw);
  if (!normalized.trim()) {
    return { ok: false, error: { code: "EMPTY_EXTRACTION", message: "Extracted content is empty." } };
  }
  return { ok: true, result: { sourceText: normalized, sourceType, fileName } };
}

export interface SourceExtractionInput {
  fileName: string;
  sourceType: SourceType;
  contentBase64: string;
}

export async function extractSourceFile(input: SourceExtractionInput): Promise<SourceExtractionOutcome> {
  const buffer = Buffer.from(input.contentBase64, "base64");

  if (!buffer.length) {
    return { ok: false, error: { code: "EMPTY_EXTRACTION", message: "Decoded file content is empty." } };
  }
  if (buffer.length > MAX_SOURCE_FILE_BYTES) {
    return {
      ok: false,
      error: {
        code: "FILE_TOO_LARGE",
        message: `File is ${formatMb(buffer.length)}MB, exceeding the ${formatMb(MAX_SOURCE_FILE_BYTES)}MB limit.`,
      },
    };
  }

  // Sniff, don't trust: a real PDF is extracted as one regardless of what the
  // caller declared; a declared "pdf" that isn't one is rejected as
  // corrupt/misnamed rather than silently falling through to the text path.
  if (looksLikePdf(buffer)) {
    return extractPdf(buffer, input.fileName);
  }
  if (input.sourceType === "pdf") {
    return {
      ok: false,
      error: { code: "INVALID_PDF", message: "File does not appear to be a valid PDF — it may be corrupt or misnamed." },
    };
  }

  return extractPlainText(buffer, input.fileName, input.sourceType);
}
