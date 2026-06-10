import tseslint from "typescript-eslint";

export default tseslint.config(
    {
        ignores: ["main.js", "node_modules/**", "scripts/**", "*.config.*", "esbuild.config.mjs"],
    },
    {
        files: ["src/**/*.ts"],
        extends: [...tseslint.configs.recommended],
        rules: {
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/no-unused-vars": [
                "warn",
                { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
            ],
        },
    }
);
