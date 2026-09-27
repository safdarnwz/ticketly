-- =============================================================================
-- 0110_city_codes
--
-- A short, unique 3-letter code per city (DEL, PAT, JAI…), shared by every
-- operator. Service codes are built from it: DEL-PAT-1500 is the operator's
-- Delhi → Patna service leaving at 15:00, whichever bus runs it that day.
--
-- The code is the first three letters of the name; when another city holds
-- them, the first letter and the next two consonants (Channapatna → CHN
-- when Chandigarh has CHA), then the first two letters and the last one,
-- then the first two letters and a digit. New cities get theirs on insert.
-- =============================================================================

-- migrate:up

ALTER TABLE cities ADD COLUMN code text;
ALTER TABLE cities ADD CONSTRAINT cities_code_format CHECK (code ~ '^[A-Z][A-Z0-9]{2}$');
CREATE UNIQUE INDEX cities_code_key ON cities (code);

CREATE FUNCTION city_code_for(city_name text, city_id uuid) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  letters text := upper(regexp_replace(coalesce(city_name, ''), '[^A-Za-z]', '', 'g'));
  consonants text;
  candidate text;
  candidates text[] := '{}';
  d int;
BEGIN
  IF length(letters) < 3 THEN letters := rpad(letters, 3, 'X'); END IF;
  consonants := regexp_replace(substr(letters, 2), '[AEIOU]', '', 'g');
  candidates := candidates || substr(letters, 1, 3);
  IF length(consonants) >= 2 THEN candidates := candidates || (substr(letters, 1, 1) || substr(consonants, 1, 2)); END IF;
  candidates := candidates || (substr(letters, 1, 2) || right(letters, 1));
  FOR d IN 2..9 LOOP candidates := candidates || (substr(letters, 1, 2) || d::text); END LOOP;
  FOREACH candidate IN ARRAY candidates LOOP
    IF NOT EXISTS (SELECT 1 FROM cities WHERE code = candidate AND id IS DISTINCT FROM city_id) THEN
      RETURN candidate;
    END IF;
  END LOOP;
  RETURN NULL; -- the unique index then refuses the city; a platform admin sets a code by hand
END $$;

CREATE FUNCTION cities_fill_code() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.code IS NULL THEN NEW.code := city_code_for(NEW.name, NEW.id); END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER cities_fill_code BEFORE INSERT ON cities
  FOR EACH ROW EXECUTE FUNCTION cities_fill_code();

-- Existing cities, oldest first, so the better-known name keeps the plain code.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT id, name FROM cities WHERE code IS NULL ORDER BY created_at, name LOOP
    UPDATE cities SET code = city_code_for(c.name, c.id) WHERE id = c.id;
  END LOOP;
END $$;

-- migrate:down

DROP TRIGGER IF EXISTS cities_fill_code ON cities;
DROP FUNCTION IF EXISTS cities_fill_code();
DROP FUNCTION IF EXISTS city_code_for(text, uuid);
DROP INDEX IF EXISTS cities_code_key;
ALTER TABLE cities DROP CONSTRAINT IF EXISTS cities_code_format;
ALTER TABLE cities DROP COLUMN IF EXISTS code;
