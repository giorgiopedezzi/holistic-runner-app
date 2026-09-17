import type { PostgresDatabase } from "../db/postgres.ts";
import { clientQueryable } from "../db/query.ts";
import { parseFit } from "../domain/fit-parser.ts";
import { crossValidateFitParser } from "../domain/fit-file-parser-validate.ts";
import { readFitZip, type ZipReadLimits } from "../domain/zip/reader.ts";
import { createOwnedActivitiesRepo } from "../repositories/owned-activities.repo.ts";

export type FitImportStatus = "imported" | "duplicate" | "failed";
export interface FitImportResult {
  filename: string;
  status: FitImportStatus;
  reason?: string;
}
export interface FitBatchImportResult {
  results: FitImportResult[];
  summary: { imported: number; duplicates: number; failed: number };
}

function failureReason(error: unknown): string {
  if (!(error instanceof Error) || error.message.trim() === "") return "FIT import failed.";
  return error.message.replace(/[\r\n]+/g, " ").slice(0, 240);
}

function assertFitEnvelope(data: Buffer): void {
  if (data.length < 12) throw new Error("Invalid FIT header.");
  const headerSize = data.readUInt8(0);
  if (headerSize < 12 || headerSize > data.length || data.subarray(8, 12).toString("ascii") !== ".FIT") {
    throw new Error("Invalid FIT header.");
  }
  const payloadEnd = headerSize + data.readUInt32LE(4);
  if (payloadEnd > data.length || (data.length !== payloadEnd && data.length !== payloadEnd + 2)) {
    throw new Error("Invalid FIT file length.");
  }
}

async function mapBounded<T, R>(values: T[], concurrency: number, work: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= values.length) return;
      results[index] = await work(values[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

export function createFitImportService(db: PostgresDatabase) {
  async function importOne(userId: string, filename: string, data: Buffer): Promise<FitImportResult> {
    try {
      assertFitEnvelope(data);
      const parsed = parseFit(data, filename);
      await crossValidateFitParser(data, filename, parsed);
      const inserted = await db.transaction(async client => {
        const repo = createOwnedActivitiesRepo(clientQueryable(client), userId);
        const row = await repo.insertGarminActivity(parsed.activity);
        if (!row) return false;
        for (const point of parsed.trackPoints) await repo.insertTrackPoint(row.id, point);
        return true;
      });
      return inserted ? { filename, status: "imported" } : { filename, status: "duplicate", reason: "Already imported." };
    } catch (error) {
      return { filename, status: "failed", reason: failureReason(error) };
    }
  }

  async function importArchive(
    userId: string,
    archive: Buffer,
    options: ZipReadLimits & { parseConcurrency: number },
  ): Promise<FitBatchImportResult> {
    try {
      const entries = readFitZip(archive, options);
      const results = await mapBounded(entries, options.parseConcurrency, async entry => {
        try {
          return await importOne(userId, entry.filename, entry.data);
        } finally {
          entry.data.fill(0);
        }
      });
      return {
        results,
        summary: {
          imported: results.filter(result => result.status === "imported").length,
          duplicates: results.filter(result => result.status === "duplicate").length,
          failed: results.filter(result => result.status === "failed").length,
        },
      };
    } finally {
      archive.fill(0);
    }
  }

  return { importOne, importArchive };
}

export type FitImportService = ReturnType<typeof createFitImportService>;
