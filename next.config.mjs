/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emits a plain static site into out/, with no Node runtime required. This
  // is what makes the build deployable to basic PHP/Apache hosting.
  output: "export",

  // Apache serves a directory by its index file, so /docs/ has to be a real
  // directory containing index.html rather than a bare docs.html.
  trailingSlash: true,

  // The Next image optimiser is a server feature and cannot run on static
  // hosting; without this the build fails on any next/image usage.
  images: { unoptimized: true },

  // Served from the root of its own subdomain (universcan.lolisoft.eu), so
  // no basePath or assetPrefix. If this ever moves under a path, both must
  // be set to that path or every asset 404s.
  productionBrowserSourceMaps: false,
};

export default nextConfig;
