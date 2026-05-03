const fs = require("fs");
const path = require("path");

const esmDir = path.resolve(process.argv[2] ?? path.join("dist", "esm"));

function walkJavaScriptFiles(dir) {
  if (!fs.existsSync(dir)) {
    throw new Error(`ESM output directory does not exist: ${dir}`);
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkJavaScriptFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(entryPath);
    }
  }

  return files;
}

function hasExtension(specifierPath) {
  return path.posix.extname(specifierPath) !== "";
}

function withJsExtension(specifier) {
  const match = specifier.match(/^([^?#]*)([?#].*)?$/);
  if (!match) {
    return specifier;
  }

  const [, specifierPath, suffix = ""] = match;
  if (
    !specifierPath.startsWith(".") ||
    specifierPath.endsWith("/") ||
    hasExtension(specifierPath)
  ) {
    return specifier;
  }

  return `${specifierPath}.js${suffix}`;
}

function rewriteSpecifiers(source) {
  return source
    .replace(
      /(\bfrom\s*["'])(\.{1,2}\/[^"']+)(["'])/g,
      (_match, prefix, specifier, suffix) =>
        `${prefix}${withJsExtension(specifier)}${suffix}`,
    )
    .replace(
      /(\bimport\s*["'])(\.{1,2}\/[^"']+)(["'])/g,
      (_match, prefix, specifier, suffix) =>
        `${prefix}${withJsExtension(specifier)}${suffix}`,
    )
    .replace(
      /(\bimport\s*\(\s*["'])(\.{1,2}\/[^"']+)(["']\s*\))/g,
      (_match, prefix, specifier, suffix) =>
        `${prefix}${withJsExtension(specifier)}${suffix}`,
    );
}

for (const file of walkJavaScriptFiles(esmDir)) {
  const source = fs.readFileSync(file, "utf8");
  const rewritten = rewriteSpecifiers(source);
  if (rewritten !== source) {
    fs.writeFileSync(file, rewritten);
  }
}

fs.writeFileSync(
  path.join(esmDir, "package.json"),
  `${JSON.stringify({ type: "module" }, null, 2)}\n`,
);
