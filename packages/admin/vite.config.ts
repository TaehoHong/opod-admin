import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
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
