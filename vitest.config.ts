import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
    test: {
        include: ["src/**/*.test.ts"],
        environment: "node",
    },
    resolve: {
        alias: {
            // Integration tests exercise the real sync engine; the Obsidian API
            // surface it touches is provided by a small stub.
            obsidian: fileURLToPath(new URL("./src/testing/obsidianStub.ts", import.meta.url)),
        },
    },
});
