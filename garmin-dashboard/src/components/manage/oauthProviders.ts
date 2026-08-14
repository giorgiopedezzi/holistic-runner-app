import { api } from "@/api/client";
import type { OAuthProvider } from "./OAuthSyncSection";

// Concrete provider descriptors for OAuthSyncSection (HRA-73) — explicit
// data, not an isWithings/isStrava boolean.
export const WITHINGS_PROVIDER: OAuthProvider = {
  id:    "withings",
  label: "Withings",
  noun:  "measurements",
  description: "Pulls weight and body composition measurements from the Withings API for the range below (defaults to since your last sync if you leave it alone).",
  api: {
    tokenStatus: api.body.tokenStatus,
    loginUrl:    api.body.loginUrl,
    sync:        api.body.sync,
  },
};

export const STRAVA_PROVIDER: OAuthProvider = {
  id:    "strava",
  label: "Strava",
  noun:  "activities",
  description: "Pulls activities from the Strava API for the range below (defaults to since your last sync if you leave it alone). Activities that match an existing one in time and distance are skipped as likely duplicates rather than double-imported.",
  api: {
    tokenStatus: api.strava.tokenStatus,
    loginUrl:    api.strava.loginUrl,
    sync:        api.strava.sync,
  },
};
