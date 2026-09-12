/**
 * controllers/source-files.controller.ts (HRA-327)
 * HTTP boundary for the source-file extraction endpoint — decodes an
 * uploaded file's base64 content, delegates to the pure
 * domain/source-extraction.ts transform, and shapes the result/rejection.
 * No repo, no service: nothing here persists or orchestrates beyond a single
 * pure call, same pattern plan-templates.controller.ts's `generate` handler
 * uses for its own parse-only preview.
 */
import type { AppContext, Handler } from "../http/context.ts";
import { send } from "../http/respond.ts";
import { readJsonBody } from "../http/request.ts";
import { payloadTooLarge, unprocessable } from "../http/problem.ts";
import { extractSourceFile, SOURCE_TYPES } from "../domain/source-extraction.ts";
import type { SourceType } from "../domain/source-extraction.ts";

type ExtractBody = Partial<{ fileName: string; sourceType: string; contentBase64: string }>;

function isSourceType(value: unknown): value is SourceType {
  return typeof value === "string" && (SOURCE_TYPES as readonly string[]).includes(value);
}

// Size/page-count limits map to 413 (the request describes a payload larger
// than this endpoint accepts); every other rejection reason is a 422 (the
// request parsed fine but the file content itself breaks a rule).
const OVERSIZED_CODES = new Set(["FILE_TOO_LARGE", "TOO_MANY_PAGES"]);

export function createSourceFilesController(_ctx: AppContext) {
  const extract: Handler = async (req, res) => {
    const body = await readJsonBody<ExtractBody>(req);
    const fileName = body.fileName?.trim();
    if (!fileName) throw unprocessable("fileName is required.");
    if (!isSourceType(body.sourceType)) {
      throw unprocessable(`sourceType is required and must be one of: ${SOURCE_TYPES.join(", ")}.`);
    }
    if (!body.contentBase64) throw unprocessable("contentBase64 is required.");

    const outcome = await extractSourceFile({ fileName, sourceType: body.sourceType, contentBase64: body.contentBase64 });
    if (!outcome.ok) {
      const { code, message } = outcome.error;
      const extra = { errors: [{ field: "contentBase64", message: code }] };
      throw OVERSIZED_CODES.has(code) ? payloadTooLarge(message, extra) : unprocessable(message, extra);
    }
    return send(res, outcome.result);
  };

  return { extract };
}
