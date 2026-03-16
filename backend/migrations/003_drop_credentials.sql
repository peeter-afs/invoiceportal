-- Migration: Drop portal_user_credentials (no longer used after Futursoft B2C auth)
-- Run this ONLY after confirming Futursoft auth is working correctly.
DROP TABLE IF EXISTS portal_user_credentials;
