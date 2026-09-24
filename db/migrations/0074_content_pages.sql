-- =============================================================================
-- 0074_content_pages
--
-- Storefront pages were kept twice: cms_pages (draft/published, no history)
-- and platform_legal_pages (versioned with an effective date — what makes a
-- change to the Terms enforceable). One table now holds both, with both
-- capabilities: every page has a status AND a version/effective_from that
-- moves whenever the published body changes. `kind` keeps legal pages
-- distinguishable (they may never be unpublished).
-- =============================================================================

-- migrate:up
CREATE TABLE content_pages (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  slug            text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,119}$'),
  kind            text NOT NULL DEFAULT 'page' CHECK (kind IN ('page', 'legal')),
  title           text NOT NULL,
  body            text NOT NULL DEFAULT '',          -- Markdown
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  version         integer NOT NULL DEFAULT 1,
  effective_from  timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'legal' OR status = 'published')
);
CREATE TRIGGER content_pages_updated_at BEFORE UPDATE ON content_pages FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO content_pages (id, slug, kind, title, body, status, version, effective_from, updated_at)
SELECT id, slug, 'legal', title, body_md, 'published', version, effective_from, updated_at
  FROM platform_legal_pages;

INSERT INTO content_pages (id, slug, kind, title, body, status, created_at, updated_at)
SELECT id, slug, 'page', title, body, status, created_at, updated_at
  FROM cms_pages
ON CONFLICT (slug) DO NOTHING;

DROP TABLE cms_pages;
DROP TABLE platform_legal_pages;

-- migrate:down
CREATE TABLE cms_pages (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  slug        text NOT NULL UNIQUE,
  title       text NOT NULL,
  body        text NOT NULL DEFAULT '',
  status      text NOT NULL DEFAULT 'draft',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER cms_pages_updated_at BEFORE UPDATE ON cms_pages FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TABLE platform_legal_pages (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  slug            text NOT NULL UNIQUE,
  title           text NOT NULL,
  body_md         text NOT NULL,
  version         integer NOT NULL DEFAULT 1,
  effective_from  timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
INSERT INTO platform_legal_pages (id, slug, title, body_md, version, effective_from, updated_at)
SELECT id, slug, title, body, version, effective_from, updated_at FROM content_pages WHERE kind = 'legal';
INSERT INTO cms_pages (id, slug, title, body, status, created_at, updated_at)
SELECT id, slug, title, body, status, created_at, updated_at FROM content_pages WHERE kind = 'page';
DROP TABLE content_pages;
