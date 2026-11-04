ALTER TABLE demo_sessions ADD COLUMN context_json JSONB;
ALTER TABLE demo_sessions ADD CONSTRAINT demo_context_object CHECK (context_json IS NULL OR COALESCE(
  (jsonb_typeof(context_json) = 'object' AND context_json->>'contextOrigin' = 'ILLUSTRATIVE_DEMO'
   AND context_json->>'contextVersion' IS NOT NULL), false));
CREATE FUNCTION demo_context_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.context_json IS DISTINCT FROM OLD.context_json THEN
    RAISE EXCEPTION 'Demo session context is immutable; legacy sessions remain missing';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER demo_context_immutable BEFORE UPDATE ON demo_sessions
FOR EACH ROW EXECUTE FUNCTION demo_context_immutable();
