import { defineConfig, mergeConfig } from "vitest/config"
import viteConfig from "./vite.config.ts"

export default mergeConfig(viteConfig, defineConfig({
  test: {
    environment: "node",
    include: ["tests/domain/**/*.test.ts", "tests/server/**/*.test.ts"],
  },
}))
