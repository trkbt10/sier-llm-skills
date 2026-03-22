/**
 * @file ESLint rule to disallow re-export declarations outside designated entry points.
 *
 * Allowed entry points:
 *   - src/index.ts or src/index.tsx
 *   - Files corresponding to paths listed in package.json "exports"
 */
import { readFileSync } from "node:fs";
import { resolve, relative } from "node:path";

/**
 * Recursively collect all file-path strings from a package.json "exports" value.
 */
function collectExportPaths(value) {
  const results = [];
  if (typeof value === "string") {
    results.push(value);
  } else if (typeof value === "object" && value !== null) {
    for (const v of Object.values(value)) {
      results.push(...collectExportPaths(v));
    }
  }
  return results;
}

/**
 * Convert a dist output path to the set of possible source paths.
 * e.g. "./dist/utils/index.js" → {"src/utils/index.ts", "src/utils/index.tsx"}
 */
function toSourcePaths(exportPath) {
  const base = exportPath
    .replace(/^\.\//, "")
    .replace(/^dist\//, "src/")
    .replace(/\.(js|mjs|cjs)$/, "");
  return [base + ".ts", base + ".tsx"];
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow re-export declarations outside of designated entry point files (src/index.ts(x) or package.json exports).",
    },
    schema: [],
    messages: {
      noReexport:
        "Re-export is only allowed in entry point files (src/index.ts(x) or package.json exports).",
    },
  },
  create(context) {
    const cwd = context.cwd;
    const filename = context.filename;
    const rel = relative(cwd, filename).replace(/\\/g, "/");

    // Allow src/index.ts(x)
    if (/^src\/index\.tsx?$/.test(rel)) {
      return {};
    }

    // Collect allowed source paths from package.json exports
    const allowedPaths = new Set();
    try {
      const pkg = JSON.parse(
        readFileSync(resolve(cwd, "package.json"), "utf8"),
      );
      if (pkg.exports) {
        for (const ep of collectExportPaths(pkg.exports)) {
          for (const sp of toSourcePaths(ep)) {
            allowedPaths.add(sp);
          }
        }
      }
    } catch {
      // package.json not found or unreadable — skip
    }

    if (allowedPaths.has(rel)) {
      return {};
    }

    // This file is not an entry point — forbid re-exports
    function check(node) {
      if (node.source) {
        context.report({ node, messageId: "noReexport" });
      }
    }

    return {
      ExportAllDeclaration: check,
      ExportNamedDeclaration: check,
    };
  },
};
