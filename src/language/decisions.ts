import type { TSESTree } from "@typescript-eslint/types";
import type { Decision, DecisionKind } from "../model";
import type { FunctionLike, Parents } from "./ast";
import { decisionWeight } from "./complexity";
import { markupCatches, markupLoops } from "./svelte";

const maxLabel = 70;

const anchorKinds: Readonly<Record<string, DecisionKind>> = {
  IfStatement: "if",
  ForStatement: "loop",
  ForInStatement: "loop",
  ForOfStatement: "loop",
  WhileStatement: "loop",
  DoWhileStatement: "loop",
  SwitchCase: "case",
  CatchClause: "catch",
  ReturnStatement: "return",
  ThrowStatement: "throw",
};

const isAnchor = (node: TSESTree.Node) =>
  node.type.endsWith("Statement") ||
  node.type.endsWith("Declaration") ||
  node.type === "SwitchCase" ||
  node.type === "CatchClause";

const shorten = (text: string) => {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > maxLabel ? `${compact.slice(0, maxLabel - 1)}…` : compact;
};

const anchorOf = (node: TSESTree.Node, unit: TSESTree.Node, parents: Parents): TSESTree.Node => {
  const climb = (current: TSESTree.Node): TSESTree.Node | undefined => {
    if (current === unit) return undefined;
    if (isAnchor(current)) return current;

    const parent = parents.get(current);

    return parent ? climb(parent) : undefined;
  };

  return climb(node) ?? node;
};

const grouped = (
  anchored: readonly { anchor: TSESTree.Node; weight: number; kind: DecisionKind }[],
  code: string,
): Decision[] => {
  const source = code.split("\n");
  const byLine = anchored.reduce((map, { anchor, weight, kind }) => {
    const line = anchor.loc.start.line;
    const known = map.get(line);

    return map.set(line, { line, kind: known?.kind ?? kind, weight: (known?.weight ?? 0) + weight });
  }, new Map<number, Omit<Decision, "label">>());

  return [...byLine.values()]
    .toSorted((a, b) => a.line - b.line)
    .map((entry) => ({ ...entry, label: shorten(source[entry.line - 1] ?? "") }));
};

export const functionDecisions = (
  fn: TSESTree.Node,
  owned: readonly TSESTree.Node[],
  parents: Parents,
  code: string,
): Decision[] =>
  grouped(
    owned
      .filter((node) => decisionWeight(node) > 0)
      .map((node) => {
        const anchor = anchorOf(node, fn, parents);
        return { anchor, weight: decisionWeight(node), kind: anchorKinds[anchor.type] ?? "statement" };
      }),
    code,
  );

export const markupDecisions = (owned: readonly TSESTree.Node[], code: string): Decision[] =>
  grouped(
    owned
      .filter((node) => decisionWeight(node) > 0)
      .map((node) => ({
        anchor: node,
        weight: decisionWeight(node),
        kind: markupLoops.has(node.type) ? "loop" : markupCatches.has(node.type) ? "catch" : "if",
      })),
    code,
  );

type Flow = "live" | "dead" | "none";

type Target = { kind: "loop" | "switch" | "label"; label: string | null; breaks: Flow[]; continues: Flow[] };

const joined = (...flows: readonly Flow[]): Flow =>
  flows.includes("live") ? "live" : flows.includes("dead") ? "dead" : "none";

const after = (entry: Flow): Flow => (entry === "live" ? "live" : "dead");

type Loop =
  | TSESTree.ForStatement
  | TSESTree.ForInStatement
  | TSESTree.ForOfStatement
  | TSESTree.WhileStatement
  | TSESTree.DoWhileStatement;

const loopTypes = new Set(["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement"]);

const isLoop = (node: TSESTree.Node): node is Loop => loopTypes.has(node.type);

export const waysOut = (fn: FunctionLike): number => {
  const targets: Target[] = [];
  let exits = 0;

  const enter = (kind: Target["kind"], label: string | null, run: (target: Target) => Flow): Flow => {
    const target: Target = { kind, label, breaks: [], continues: [] };

    targets.push(target);
    const flow = run(target);
    targets.pop();

    return flow;
  };

  const jump = (node: TSESTree.BreakStatement | TSESTree.ContinueStatement, entry: Flow): Flow => {
    const label = node.label?.name ?? null;
    const breaking = node.type === "BreakStatement";
    const target = targets.findLast((candidate) =>
      breaking
        ? label
          ? candidate.label === label
          : candidate.kind !== "label"
        : candidate.kind === "loop" && (label ? candidate.label === label : true),
    );

    if (entry !== "none") (breaking ? target?.breaks : target?.continues)?.push(entry);

    return "none";
  };

  const sequence = (statements: readonly TSESTree.Node[], entry: Flow): Flow =>
    statements.reduce((flow, statement) => walk(statement, flow, null), entry);

  const loop = (node: Loop, entry: Flow, label: string | null): Flow =>
    enter("loop", label, (target) => {
      if (node.type !== "DoWhileStatement") {
        walk(node.body, after(entry), null);
        return joined(after(entry), ...target.breaks);
      }

      return joined(after(joined(walk(node.body, entry, null), ...target.continues)), ...target.breaks);
    });

  const switchFlow = (node: TSESTree.SwitchStatement, entry: Flow, label: string | null): Flow => {
    const out = after(entry);

    return enter("switch", label, (target) => {
      const last = node.cases.reduce<Flow>(
        (previous, item) => sequence(item.consequent, joined(out, previous)),
        "none",
      );
      return joined(last, ...target.breaks, node.cases.some((item) => !item.test) ? "none" : out);
    });
  };

  const tryFlow = (node: TSESTree.TryStatement, entry: Flow): Flow => {
    const out = after(entry);
    const before = joined(walk(node.block, out, null), node.handler ? walk(node.handler.body, out, null) : "none");

    if (!node.finalizer) return before;

    const finished = walk(node.finalizer, out, null);

    return before === "none" ? "none" : finished;
  };

  const labeled = (node: TSESTree.LabeledStatement, entry: Flow): Flow => {
    const name = node.label.name;

    if (isLoop(node.body) || node.body.type === "SwitchStatement") return walk(node.body, entry, name);

    return enter("label", name, (target) => joined(walk(node.body, entry, null), ...target.breaks));
  };

  const walk = (node: TSESTree.Node, entry: Flow, label: string | null): Flow => {
    if (isLoop(node)) return loop(node, entry, label);

    switch (node.type) {
      case "BlockStatement":
        return sequence(node.body, entry);
      case "EmptyStatement":
        return entry;
      case "ReturnStatement":
      case "ThrowStatement":
        exits += 1;
        return "none";
      case "BreakStatement":
      case "ContinueStatement":
        return jump(node, entry);
      case "IfStatement":
        return joined(
          walk(node.consequent, after(entry), null),
          node.alternate ? walk(node.alternate, after(entry), null) : after(entry),
        );
      case "SwitchStatement":
        return switchFlow(node, entry, label);
      case "TryStatement":
        return tryFlow(node, entry);
      case "LabeledStatement":
        return labeled(node, entry);
      default:
        return after(entry);
    }
  };

  if (fn.body.type !== "BlockStatement") return 1;

  const end = sequence(fn.body.body, "live");

  return exits + (end === "live" ? 1 : 0);
};
