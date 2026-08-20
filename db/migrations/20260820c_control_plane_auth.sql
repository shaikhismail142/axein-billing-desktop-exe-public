BEGIN;

CREATE TABLE IF NOT EXISTS control_plane_nonces (
  client_key TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (client_key, nonce)
);
CREATE INDEX IF NOT EXISTS control_plane_nonces_expiry_idx
  ON control_plane_nonces (expires_at);

COMMIT;
