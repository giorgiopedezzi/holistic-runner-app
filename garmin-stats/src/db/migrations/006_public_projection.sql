-- HRA-359: explicit public projection boundary for Guest Runs Free.
--
-- The source and identifier tables are private publication-control data. The
-- public read repository is deliberately limited to the view at the bottom,
-- which contains no owner id, private resource id, failure detail, or source
-- relationship.
CREATE TABLE public_projection_sources (
  id UUID PRIMARY KEY,
  source_user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  public_slug TEXT NOT NULL UNIQUE,
  publication_state TEXT NOT NULL DEFAULT 'draft'
    CHECK (publication_state IN ('draft', 'published', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public_projection_identifiers (
  source_id UUID NOT NULL REFERENCES public_projection_sources(id) ON DELETE CASCADE,
  resource_kind TEXT NOT NULL
    CHECK (resource_kind IN ('profile', 'activity', 'plan', 'report')),
  source_resource_id TEXT NOT NULL,
  public_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, resource_kind, source_resource_id)
);

-- One replaceable snapshot per publication source makes refresh naturally
-- idempotent. A failed transaction cannot partially replace the JSON payload;
-- only the non-sensitive retry marker is updated after rollback.
CREATE TABLE public_projection_snapshots (
  source_id UUID PRIMARY KEY REFERENCES public_projection_sources(id) ON DELETE CASCADE,
  source_version_hash TEXT,
  payload JSONB,
  projected_at TIMESTAMPTZ,
  last_attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  CHECK (
    (source_version_hash IS NULL AND payload IS NULL AND projected_at IS NULL)
    OR
    (source_version_hash IS NOT NULL AND payload IS NOT NULL AND projected_at IS NOT NULL)
  )
);

CREATE VIEW published_public_projections AS
SELECT
  source.public_slug,
  snapshot.source_version_hash AS source_version,
  snapshot.payload,
  snapshot.projected_at
FROM public_projection_sources source
JOIN public_projection_snapshots snapshot ON snapshot.source_id = source.id
WHERE source.publication_state = 'published'
  AND snapshot.payload IS NOT NULL;
