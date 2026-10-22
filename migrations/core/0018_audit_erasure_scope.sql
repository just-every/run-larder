-- GOV-013 (ct, 22 October 2026): the erasure request is retained with its scope; the audit is the only scope today.
ALTER TABLE larder_audit_erasures ADD COLUMN scope TEXT NOT NULL DEFAULT 'audit' CHECK(scope IN ('audit'));
