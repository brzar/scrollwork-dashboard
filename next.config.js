/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Strict type checking on every build. The Supabase Database type is
  // hand-authored in src/lib/supabase/database.types.ts and threaded
  // through all three client builders, so table reads/writes are fully
  // typed (no more inferred-never). Keep this honest — if you change the
  // schema, update database.types.ts to match.
  typescript: { ignoreBuildErrors: false },
};

module.exports = nextConfig;
