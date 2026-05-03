import { execFileSync } from "child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("package configuration", () => {
  it("should not publish local file dependencies", () => {
    const packageJsonPath = join(__dirname, "../../../package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      exports?: unknown;
    };

    expect(packageJson.dependencies?.["@yrzhao/aves-core"]).toBeUndefined();
    expect(packageJson.dependencies).not.toEqual(
      expect.objectContaining({
        "@yrzhao/aves-core": expect.stringMatching(/^file:/),
      }),
    );
  });

  it("should publish MongoDB as an optional peer dependency", () => {
    const packageJsonPath = join(__dirname, "../../../package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      peerDependencies?: Record<string, string>;
      peerDependenciesMeta?: Record<string, { optional?: boolean }>;
      devDependencies?: Record<string, string>;
    };

    expect(packageJson.peerDependencies?.mongodb).toEqual(
      expect.stringMatching(/\^7\./),
    );
    expect(packageJson.peerDependenciesMeta?.mongodb).toEqual({
      optional: true,
    });
    expect(packageJson.devDependencies?.mongodb).toEqual(
      expect.stringMatching(/\^7\./),
    );
  });

  it("should publish explicit CommonJS, ESM, and type entry points", () => {
    const packageJsonPath = join(__dirname, "../../../package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      main?: string;
      module?: string;
      types?: string;
      exports?: unknown;
      scripts?: Record<string, string>;
    };

    expect(packageJson.main).toBe("dist/index.js");
    expect(packageJson.module).toBe("dist/esm/index.js");
    expect(packageJson.types).toBe("dist/index.d.ts");
    expect(packageJson.exports).toEqual({
      ".": {
        import: "./dist/esm/index.js",
        require: "./dist/index.js",
        types: "./dist/index.d.ts",
      },
    });
    expect(packageJson.scripts?.["build:esm"]).toContain(
      "scripts/fix-esm-imports.js",
    );
  });

  it("should expose root types without requiring optional storage peers", () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), "aves-node-types-"));
    const packageRoot = join(__dirname, "../../..");
    const declarationsDir = join(fixtureDir, "declarations");
    const consumerDir = join(fixtureDir, "consumer");
    const installedPackageDir = join(
      consumerDir,
      "node_modules",
      "@yrzhao",
      "aves-node",
    );
    const tscPath = require.resolve("typescript/bin/tsc");

    try {
      execFileSync(
        process.execPath,
        [
          tscPath,
          "--project",
          join(packageRoot, "tsconfig.json"),
          "--declaration",
          "--emitDeclarationOnly",
          "--outDir",
          declarationsDir,
        ],
        { cwd: packageRoot },
      );

      mkdirSync(installedPackageDir, { recursive: true });
      cpSync(declarationsDir, join(installedPackageDir, "dist"), {
        recursive: true,
      });
      writeFileSync(
        join(installedPackageDir, "package.json"),
        JSON.stringify(
          {
            name: "@yrzhao/aves-node",
            types: "dist/index.d.ts",
          },
          null,
          2,
        ),
      );
      writeFileSync(
        join(consumerDir, "index.ts"),
        [
          'import { AvesServer, type AvesServerConfig } from "@yrzhao/aves-node";',
          "",
          "const config: AvesServerConfig = {};",
          "new AvesServer(config);",
        ].join("\n"),
      );
      writeFileSync(
        join(consumerDir, "tsconfig.json"),
        JSON.stringify(
          {
            compilerOptions: {
              module: "commonjs",
              target: "es2020",
              strict: true,
              skipLibCheck: false,
              moduleResolution: "node",
              typeRoots: [join(packageRoot, "node_modules", "@types")],
              types: ["node"],
            },
            include: ["index.ts"],
          },
          null,
          2,
        ),
      );

      execFileSync(
        process.execPath,
        [tscPath, "--project", join(consumerDir, "tsconfig.json"), "--noEmit"],
        { cwd: consumerDir },
      );
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it("should rewrite built ESM relative imports for Node resolution", () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), "aves-node-esm-"));
    const scriptPath = join(__dirname, "../../../scripts/fix-esm-imports.js");

    try {
      mkdirSync(join(fixtureDir, "core"), { recursive: true });
      mkdirSync(join(fixtureDir, "lazy"), { recursive: true });
      writeFileSync(
        join(fixtureDir, "index.js"),
        [
          'export { AvesServer } from "./core/AvesServer";',
          'import "./polyfill";',
          'const modulePromise = import("./lazy/module");',
        ].join("\n"),
      );

      execFileSync(process.execPath, [scriptPath, fixtureDir]);

      expect(readFileSync(join(fixtureDir, "index.js"), "utf8")).toContain(
        'from "./core/AvesServer.js"',
      );
      expect(readFileSync(join(fixtureDir, "index.js"), "utf8")).toContain(
        'import "./polyfill.js"',
      );
      expect(readFileSync(join(fixtureDir, "index.js"), "utf8")).toContain(
        'import("./lazy/module.js")',
      );
      expect(
        JSON.parse(readFileSync(join(fixtureDir, "package.json"), "utf8")),
      ).toEqual({ type: "module" });
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});
