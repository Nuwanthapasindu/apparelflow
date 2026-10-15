import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // The generated Prisma client loads its native engine from disk, so the tracer cannot see it.
  // Ship the Linux engine with every server route or each database call fails on Vercel.
  outputFileTracingIncludes: {
    "/*": ["./src/generated/prisma/libquery_engine-rhel-openssl-3.0.x.so.node"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
