import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import * as ts from "typescript";

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  });
}

describe("admin social activity ownership", () => {
  it("keeps scoped repositories private to their owning services", () => {
    const src = resolve(__dirname, "..");
    const owners = new Map([
      ["character.repository", resolve(src, "characters/character.service.ts")],
      [
        "character-action-log.repository",
        resolve(src, "characters/character-action-log.service.ts"),
      ],
      [
        "character-social-activity-policy.repository",
        resolve(src, "characters/character-social-activity-policy.service.ts"),
      ],
      [
        "character-social-activity-job.repository",
        resolve(src, "characters/character-social-activity-job.service.ts"),
      ],
      [
        "post-reaction.repository",
        resolve(src, "admin/post-reaction.service.ts"),
      ],
    ]);
    const scopedServices = new Set([
      ...owners.values(),
      resolve(
        src,
        "characters/character-social-activity-application.service.ts",
      ),
    ]);
    const violations: string[] = [];
    for (const path of sourceFiles(src).filter(
      (file) => file.endsWith(".ts") && !file.endsWith(".spec.ts"),
    )) {
      const file = ts.createSourceFile(
        path,
        readFileSync(path, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      const repositoryBindings = new Set<string>();
      for (const statement of file.statements) {
        if (
          !ts.isImportDeclaration(statement) ||
          !ts.isStringLiteral(statement.moduleSpecifier)
        )
          continue;
        const target = statement.moduleSpecifier.text;
        if (
          scopedServices.has(resolve(path)) &&
          (target === "drizzle-orm" ||
            [
              "database.service",
              "database-transaction-context",
              "schema",
            ].includes(basename(target)))
        ) {
          violations.push(`${path} bypasses its repository through ${target}`);
        }
        const owner = owners.get(basename(target));
        if (!owner) continue;
        if (resolve(path) !== owner && !path.endsWith(".module.ts")) {
          violations.push(`${path} imports ${target} outside its owner`);
        }
        const bindings = statement.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) {
          for (const binding of bindings.elements) {
            repositoryBindings.add(binding.name.text);
          }
        }
      }
      if (!path.endsWith(".module.ts")) continue;
      const inspect = (node: ts.Node): void => {
        if (
          ts.isPropertyAssignment(node) &&
          node.name.getText(file) === "exports"
        ) {
          const inspectExport = (value: ts.Node): void => {
            if (ts.isIdentifier(value) && repositoryBindings.has(value.text)) {
              violations.push(`${path} exports repository ${value.text}`);
            }
            ts.forEachChild(value, inspectExport);
          };
          inspectExport(node.initializer);
        }
        ts.forEachChild(node, inspect);
      };
      inspect(file);
    }
    expect(violations).toEqual([]);
  });
});
