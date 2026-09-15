import type { AppContext, Handler } from "../http/context.ts";
import { requestIdentity } from "../http/auth-context.ts";
import { readJsonBody } from "../http/request.ts";
import { send } from "../http/respond.ts";
import { notFound, unprocessable, unauthorized } from "../http/problem.ts";
import type { ProfileUpdate } from "../repositories/identity.repo.ts";

const confirmation = "DELETE MY ACCOUNT";

function profileBody(value: unknown): ProfileUpdate {
  if (!value || typeof value !== "object") throw unprocessable("A complete profile is required.");
  const body = value as Record<string, unknown>;
  const nullableText = (key: string) => !(key in body) ? undefined : body[key] == null ? null : typeof body[key] === "string" ? body[key] : undefined;
  const displayName = nullableText("display_name"); const locale = nullableText("locale"); const timezone = nullableText("timezone");
  const unitSystem = !("unit_system" in body) ? undefined : body.unit_system == null ? null : body.unit_system === "metric" || body.unit_system === "imperial" ? body.unit_system : undefined;
  if (displayName === undefined || locale === undefined || timezone === undefined || unitSystem === undefined) throw unprocessable("Profile fields are invalid.");
  return { displayName, locale, unitSystem, timezone };
}

export function createAccountPrivacyController(ctx: AppContext) {
  const profile: Handler = async (req, res) => {
    const user = await ctx.services.identity.updateProfile(requestIdentity(req).userId, profileBody(await readJsonBody(req)));
    send(res, { display_name: user.display_name, locale: user.locale, unit_system: user.unit_system, timezone: user.timezone });
  };
  const revokeOthers: Handler = async (req, res) => {
    const identity = requestIdentity(req);
    if (!(await ctx.services.identity.requireRecentAuthentication(identity.userId, identity.sessionId))) throw unauthorized();
    await ctx.services.identity.revokeOtherSessions(identity.userId, identity.sessionId!);
    send(res, { revoked: true });
  };
  const createExport: Handler = async (req, res) => {
    const identity = requestIdentity(req);
    const result = await ctx.services.accountPrivacy.requestExport(identity.userId);
    send(res, { expires_at: result.expiresAt, download_url: `/api/v1/account/exports/${result.id}?token=${encodeURIComponent(result.secret)}` }, 201);
  };
  const downloadExport: Handler = async (req, res, url) => {
    const id = /^\/api\/v1\/account\/exports\/([0-9a-f-]+)$/.exec(url.pathname)?.[1];
    const token = url.searchParams.get("token");
    if (!id || !token) throw notFound();
    const row = await ctx.services.accountPrivacy.getExport(id, requestIdentity(req).userId, token);
    if (!row) throw notFound();
    await ctx.services.accountPrivacy.recordExportDownloaded(requestIdentity(req).userId, id);
    const filename = `runs-free-personal-data-${new Date(row.created_at).toISOString().slice(0, 10)}.json`;
    res.writeHead(200, { "Content-Type": "application/json", "Content-Disposition": `attachment; filename=\"${filename}\"`, "Cache-Control": "no-store" });
    res.end(JSON.stringify(row.payload));
  };
  const requestDeletion: Handler = async (req, res) => {
    const identity = requestIdentity(req);
    const body = await readJsonBody<{ confirmation?: unknown }>(req);
    if (body.confirmation !== confirmation) throw unprocessable("Enter the exact account-deletion confirmation.");
    if (!(await ctx.services.identity.requireRecentAuthentication(identity.userId, identity.sessionId))) throw unauthorized();
    send(res, await ctx.services.accountPrivacy.requestDeletion(identity.userId), 202);
  };
  return { profile, revokeOthers, createExport, downloadExport, requestDeletion };
}
