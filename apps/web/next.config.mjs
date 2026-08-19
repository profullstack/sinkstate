/** @type {import('next').NextConfig} */
const nextConfig = {
  // Deliberately NOT `output: 'standalone'`. Its dependency tracing walks real
  // filesystem paths and omits next's own @swc/helpers under pnpm's symlinked
  // store, so the bundle builds and then dies with MODULE_NOT_FOUND before
  // binding a port. Ship real node_modules instead.
  reactStrictMode: true,
  transpilePackages: [],
};

export default nextConfig;
