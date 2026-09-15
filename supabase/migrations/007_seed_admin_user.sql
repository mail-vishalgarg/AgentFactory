-- One-time seed: the platform's admin account. Everyone else registers
-- through the Login/Register page (is_admin defaults to false there).
-- password_hash uses pgcrypto's bcrypt (blowfish) — the same $2a$/$2b$ format
-- Python's `bcrypt` library verifies, so no separate seed script is needed.
INSERT INTO users (email, password_hash, is_admin)
VALUES ('admin@capstone.com', crypt('@boss1Login', gen_salt('bf', 10)), true)
ON CONFLICT (email) DO NOTHING;
