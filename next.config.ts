import type { NextConfig } from "next";
import { execSync } from "child_process";

let commitCount = "0";
let commitHash = "dev";
try {
  commitCount = execSync("git rev-list --count HEAD").toString().trim();
  commitHash = execSync("git rev-parse --short HEAD").toString().trim();
} catch {
  // fallback if git is unavailable
}

const nextConfig: NextConfig = {
  env: {
    BUILD_TIME: new Date().toLocaleString(),
    NEXT_PUBLIC_APP_VERSION: `0.1.${commitCount}`,
    NEXT_PUBLIC_COMMIT_HASH: commitHash,
  }
};

export default nextConfig;
