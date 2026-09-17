import type { AppContext, Handler } from "../http/context.ts";
import { requestIdentity } from "../http/auth-context.ts";
import { readBodyBuffer } from "../http/request.ts";
import { send } from "../http/respond.ts";
import { unprocessable } from "../http/problem.ts";
import { FitZipValidationError } from "../domain/zip/reader.ts";

export function createFitImportController(ctx: AppContext) {
  const uploadZip: Handler = async (req, res) => {
    const mediaType = String(req.headers["content-type"] ?? "").split(";", 1)[0]!.trim().toLowerCase();
    if (mediaType !== "application/zip" && mediaType !== "application/x-zip-compressed") {
      throw unprocessable("Content-Type must be application/zip.");
    }
    const limits = ctx.config.fitZipImport;
    const archive = await readBodyBuffer(req, limits.maxCompressedBytes);
    if (archive.length === 0) throw unprocessable("The ZIP upload is empty.");
    const userId = requestIdentity(req).userId;
    try {
      const result = await ctx.services.fitImport.importArchive(userId, archive, {
        maxExpandedBytes: limits.maxExpandedBytes,
        maxEntryBytes: limits.maxEntryBytes,
        maxEntries: limits.maxEntries,
        parseConcurrency: limits.parseConcurrency,
      });
      if (result.summary.imported > 0) await ctx.services.workoutAssociations.reconcile(userId);
      send(res, result);
    } catch (error) {
      if (error instanceof FitZipValidationError) throw unprocessable(error.message);
      throw error;
    }
  };

  return { uploadZip };
}
