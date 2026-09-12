/**
 * test/helpers/pdf-fixtures.ts (HRA-327)
 * Hand-built minimal PDF byte buffers for exercising domain/source-extraction.ts's
 * PDF branch without any binary fixture files or third-party generator library.
 * No xref table is written — pdf.js recovers via its own "scan for N G obj"
 * fallback, which is exactly as tolerant of real-world PDFs with a broken/missing
 * xref, so this is a faithful stand-in for a hand-authored or lightly-damaged PDF.
 */

import crypto from "node:crypto";

const PDF_PAD = Buffer.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

function escapePdfString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

// A valid multi-page PDF whose pages each contain one real text-showing
// operator — extractText should return each page's own string.
export function buildTextPdf(pagesText: string[]): Buffer {
  const objs: string[] = [];
  const n = pagesText.length;
  let nextId = 3;
  const pageObjIds: number[] = [];
  for (let i = 0; i < n; i++) pageObjIds.push(nextId++);
  const contentObjIds: number[] = [];
  for (let i = 0; i < n; i++) contentObjIds.push(nextId++);
  const fontId = nextId++;

  objs.push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
  objs.push(`2 0 obj\n<< /Type /Pages /Kids [${pageObjIds.map(id => `${id} 0 R`).join(" ")}] /Count ${n} >>\nendobj\n`);
  for (let i = 0; i < n; i++) {
    objs.push(`${pageObjIds[i]} 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> /MediaBox [0 0 300 144] /Contents ${contentObjIds[i]} 0 R >>\nendobj\n`);
  }
  for (let i = 0; i < n; i++) {
    const content = `BT /F1 24 Tf 100 100 Td (${escapePdfString(pagesText[i])}) Tj ET`;
    objs.push(`${contentObjIds[i]} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
  }
  objs.push(`${fontId} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`);
  const body = `%PDF-1.4\n${objs.join("")}trailer\n<< /Size ${nextId} /Root 1 0 R >>\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

// A valid, single-page PDF whose content stream draws only vector graphics
// (no text-showing operator at all) — extractText legitimately returns "".
// A scanned/rasterized page is the real-world cause, but the code path this
// exercises (a structurally valid PDF with zero extractable text across every
// page) is identical either way.
export function buildImageOnlyPdf(): Buffer {
  const content = `1 0 0 RG 10 10 100 100 re f`;
  const body = `%PDF-1.4\n`
    + `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`
    + `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`
    + `3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << >> /MediaBox [0 0 300 144] /Contents 4 0 R >>\nendobj\n`
    + `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`
    + `trailer\n<< /Size 5 /Root 1 0 R >>\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

function rc4(key: Buffer, data: Buffer): Buffer {
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i] + key[i % key.length]) & 0xff;
    [S[i], S[j]] = [S[j], S[i]];
  }
  const out = Buffer.alloc(data.length);
  let i = 0; j = 0;
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) & 0xff;
    j = (j + S[i]) & 0xff;
    [S[i], S[j]] = [S[j], S[i]];
    out[k] = data[k] ^ S[(S[i] + S[j]) & 0xff];
  }
  return out;
}

function md5(...bufs: Buffer[]): Buffer {
  const h = crypto.createHash("md5");
  for (const b of bufs) h.update(b);
  return h.digest();
}

function padPassword(pw: string): Buffer {
  const buf = Buffer.from(pw, "latin1");
  if (buf.length >= 32) return buf.subarray(0, 32);
  return Buffer.concat([buf, PDF_PAD.subarray(0, 32 - buf.length)]);
}

function pdfLiteralString(buf: Buffer): string {
  let out = "(";
  for (const byte of buf) {
    out += (byte === 0x28 || byte === 0x29 || byte === 0x5c) ? "\\" + String.fromCharCode(byte) : String.fromCharCode(byte);
  }
  return out + ")";
}

// A structurally valid, RC4-40 (Standard Security Handler revision 2)
// encrypted PDF requiring a real (non-empty) user password we never supply —
// pdf.js rejects it with PasswordException, exactly like a genuine
// password-protected file. An empty user password would open with no prompt
// at all, so this deliberately sets a real one on both the user and owner
// entries (Algorithms 3.2/3.3/3.4, ISO 32000-1 §7.6.3).
export function buildEncryptedPdf(): Buffer {
  const userPw = "secret123";
  const ownerPw = "ownerSecret";
  const P = -44;
  const id = crypto.randomBytes(16);

  const paddedUser = padPassword(userPw);
  const paddedOwner = padPassword(ownerPw);

  const rc4KeyO = md5(paddedOwner).subarray(0, 5);
  const O = rc4(rc4KeyO, paddedUser);

  const pBuf = Buffer.alloc(4);
  pBuf.writeInt32LE(P, 0);

  const fileKey = md5(paddedUser, O, pBuf, id).subarray(0, 5);
  const U = rc4(fileKey, PDF_PAD);

  function objectKey(objNum: number, genNum: number): Buffer {
    const objBuf = Buffer.alloc(3);
    objBuf.writeUIntLE(objNum, 0, 3);
    const genBuf = Buffer.alloc(2);
    genBuf.writeUIntLE(genNum, 0, 2);
    return md5(fileKey, objBuf, genBuf).subarray(0, 10);
  }

  const contentPlain = Buffer.from("BT /F1 24 Tf 100 100 Td (Hello Encrypted) Tj ET", "latin1");
  const contentEnc = rc4(objectKey(5, 0), contentPlain);

  const head = Buffer.from(
    "%PDF-1.4\n"
    + "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"
    + "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"
    + "3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 300 144] /Contents 5 0 R >>\nendobj\n"
    + "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    "latin1",
  );
  const streamHeader = Buffer.from(`5 0 obj\n<< /Length ${contentEnc.length} >>\nstream\n`, "latin1");
  const streamFooter = Buffer.from("\nendstream\nendobj\n", "latin1");
  const encryptDict = Buffer.from(
    `6 0 obj\n<< /Filter /Standard /V 1 /R 2 /O ${pdfLiteralString(O)} /U ${pdfLiteralString(U)} /P ${P} >>\nendobj\n`,
    "latin1",
  );
  const idHex = id.toString("hex").toUpperCase();
  const trailer = Buffer.from(`trailer\n<< /Size 7 /Root 1 0 R /Encrypt 6 0 R /ID [<${idHex}> <${idHex}>] >>\n%%EOF\n`, "latin1");

  return Buffer.concat([head, streamHeader, contentEnc, streamFooter, encryptDict, trailer]);
}
