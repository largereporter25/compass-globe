/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { isServer }) => {
    config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false, crypto: false };
    // transformers.js reaches for the native Node ONNX runtime. In the browser
    // it must use onnxruntime-web instead, so the native binding is stubbed out.
    config.resolve.alias = {
      ...config.resolve.alias,
      "onnxruntime-node$": false,
      sharp$: false,
    };
    if (isServer) config.externals = [...(config.externals || []), "@xenova/transformers"];
    return config;
  },
};
export default nextConfig;
