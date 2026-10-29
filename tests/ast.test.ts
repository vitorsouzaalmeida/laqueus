import type { TSESTree } from "@typescript-eslint/types";
import { describe, expect, it } from "vitest";
import { parseSource } from "../src/language/parse";
import { children, descendants, indexTree, isFunction } from "../src/language/ast";

const parse = (code: string) => {
  const parsed = parseSource("/virtual", "/virtual/a.ts", code);

  if (!parsed.ok) throw new Error(parsed.error.message);

  return parsed.value;
};

describe("ast walk", () => {
  it("lists descendants in document order and does not enter stop nodes", () => {
    const { roots, keys } = parse("function outer() { const inner = () => 1; return inner(); }");
    const outer = indexTree(roots, keys).nodes.find(isFunction);

    if (!outer) throw new Error("missing function");

    expect(descendants(outer, keys, isFunction).map((node) => node.type)).toEqual([
      "Identifier",
      "BlockStatement",
      "VariableDeclaration",
      "VariableDeclarator",
      "Identifier",
      "ArrowFunctionExpression",
      "ReturnStatement",
      "CallExpression",
      "Identifier",
    ]);
    expect(descendants(outer, keys).map((node) => node.type)).toContain("Literal");
  });

  it("records the parent of every node except the roots", () => {
    const { roots, keys } = parse("const a = [1, , 2]; if (a) { a.push(3); }");
    const { nodes, parents } = indexTree(roots, keys);

    expect(nodes.filter((node) => !parents.has(node))).toEqual(roots);
    expect(
      nodes.filter((node) => {
        const parent = parents.get(node);
        return parent !== undefined && !children(parent, keys).includes(node);
      }),
    ).toEqual([]);
  });

  it("walks trees deeper than the call stack", () => {
    const { roots, keys } = parse("x + y;");
    const [statement] = roots;

    if (statement?.type !== "ExpressionStatement" || statement.expression.type !== "BinaryExpression") {
      throw new Error("expected a binary expression");
    }

    const binary = statement.expression;
    const depth = 100_000;
    const deep = Array.from({ length: depth - 1 }).reduce<TSESTree.BinaryExpression>(
      (left) => ({ ...binary, left }),
      binary,
    );

    expect(indexTree([{ ...statement, expression: deep }], keys).nodes).toHaveLength(2 * depth + 2);
  });
});
