import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// 전환 기간 동안 산출물은 packages/admin/dist에 쌓인다. Nest는 dist가 있을
// 때만 React 앱을 서빙하고, 없으면 기존 정적 SPA를 그대로 쓴다.
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // 전환 기간에는 기존 index.html이 정적 SPA의 진입점이므로 React entry는
    // 별도 파일로 둔다. 전환이 끝나면 index.html로 합친다.
    rollupOptions: { input: resolve(__dirname, "index.react.html") },
  },
  server: {
    // 개발 서버에서 API는 Nest로 넘긴다. 세션 cookie가 same-origin이어야
    // 하므로 별도 origin으로 직접 호출하지 않는다.
    proxy: {
      "/api": {
        target: "http://localhost:7100",
        changeOrigin: false,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
