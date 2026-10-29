import type { TSESTree } from "@typescript-eslint/types";
import { type VisitorKeys, descendants, isFunction } from "./ast";
import { snippetBlock, templateBranches } from "./svelte";

export const excessFrom = 10;
export const highFrom = 16;

const logicalAssignments = new Set(["&&=", "||="]);
const ownedApart = new Set(["ClassBody", snippetBlock]);

export const branchWeight = (node: TSESTree.Node): number => {
  if (templateBranches.has(node.type)) return 1;

  switch (node.type) {
    case "IfStatement":
    case "ForStatement":
    case "ForInStatement":
    case "ForOfStatement":
    case "WhileStatement":
    case "DoWhileStatement":
    case "CatchClause":
    case "ConditionalExpression":
      return 1;
    case "SwitchCase":
      return node.test ? 1 : 0;
    default:
      return 0;
  }
};

export const conditionWeight = (node: TSESTree.Node): number => {
  switch (node.type) {
    case "LogicalExpression":
      return node.operator === "??" ? 0 : 1;
    case "AssignmentExpression":
      return logicalAssignments.has(node.operator) ? 1 : 0;
    default:
      return 0;
  }
};

export const decisionWeight = (node: TSESTree.Node): number => branchWeight(node) + conditionWeight(node);

export const isOwnershipBoundary = (node: TSESTree.Node) => isFunction(node) || ownedApart.has(node.type);

export const ownNodes = (fn: TSESTree.Node, keys: VisitorKeys): TSESTree.Node[] =>
  descendants(fn, keys, isOwnershipBoundary).filter((node) => !isOwnershipBoundary(node));

export const decisionsIn = (node: TSESTree.Node | null | undefined, keys: VisitorKeys): number =>
  !node || isOwnershipBoundary(node)
    ? 0
    : [node, ...ownNodes(node, keys)].reduce((total, child) => total + decisionWeight(child), 0);

const sumOver = (nodes: readonly TSESTree.Node[], weight: (node: TSESTree.Node) => number) =>
  nodes.reduce((total, node) => total + weight(node), 0);

export const cyclomaticComplexity = (fn: TSESTree.Node, keys: VisitorKeys): number =>
  1 + sumOver(ownNodes(fn, keys), decisionWeight);

export const branchComplexity = (fn: TSESTree.Node, keys: VisitorKeys): number =>
  1 + sumOver(ownNodes(fn, keys), branchWeight);

export const inclusiveComplexity = (node: TSESTree.Node, keys: VisitorKeys): number =>
  1 + sumOver(descendants(node, keys), decisionWeight);

export type Measures = { complexity: number; branches: number; inclusive: number };

export const measureTemplate = (roots: readonly TSESTree.Node[], keys: VisitorKeys): Measures => {
  const own = roots.flatMap((root) => (isOwnershipBoundary(root) ? [] : [root, ...ownNodes(root, keys)]));
  const all = roots.flatMap((root) => [root, ...descendants(root, keys)]);

  return {
    complexity: 1 + sumOver(own, decisionWeight),
    branches: 1 + sumOver(own, branchWeight),
    inclusive: 1 + sumOver(all, decisionWeight),
  };
};

export const decisionsOf = (scores: readonly number[]) => scores.reduce((sum, score) => sum + score - 1, 0);

export const excessOf = (scores: readonly number[]) =>
  scores.reduce((sum, score) => sum + Math.max(0, score - excessFrom), 0);

export const fileComplexity = (scores: readonly number[]) => ({
  maxCC: scores.length > 0 ? scores.reduce((max, score) => Math.max(max, score), 0) : null,
  decisions: decisionsOf(scores),
  excessCC: excessOf(scores),
  functionCount: scores.length,
});
