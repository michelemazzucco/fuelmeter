import type { NextConfig } from "next";
import { withPlausibleProxy } from "next-plausible";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.1.108"],
};

export default withPlausibleProxy()(nextConfig);
