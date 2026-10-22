import type { TSESTree } from "@typescript-eslint/types";
import { type FunctionLike, type VisitorKeys, descendants, isFunction, locationOf } from "./ast";
import { decisionWeight, decisionsIn, isOwnershipBoundary } from "./metrics";
import {
  type FunctionLogic,
  type LogicEdge,
  type LogicEdgeKind,
  type LogicNode,
  type LogicNodeKind,
  type LogicOutlineItem,
  functionId,
} from "./model";

type Pending = { from: string; label: string; kind: LogicEdgeKind };
type Built = { exits: Pending[]; outline: LogicOutlineItem[] };
type BreakTarget = { label: string | null; kind: "loop" | "switch" | "label"; collected: Pending[] };
type ContinueTarget = { label: string | null; target: string | null; collected: Pending[] };
type MaybeNode = TSESTree.Node | null | undefined;
type Loop = TSESTree.ForStatement | TSESTree.ForInStatement | TSESTree.ForOfStatement | TSESTree.WhileStatement;

export type LogicInput = {
  fn: FunctionLike;
  name: string;
  file: string;
  code: string;
  keys: VisitorKeys;
  complexity: number;
};

const maxLabel = 70;
const blockPreviewLines = 3;

const simpleKinds = new Set([
  "ExpressionStatement",
  "VariableDeclaration",
  "FunctionDeclaration",
  "ClassDeclaration",
  "EmptyStatement",
  "DebuggerStatement",
  "ImportDeclaration",
  "ExportNamedDeclaration",
  "ExportDefaultDeclaration",
  "TSTypeAliasDeclaration",
  "TSInterfaceDeclaration",
  "TSEnumDeclaration",
  "TSModuleDeclaration",
  "TSDeclareFunction",
  "WithStatement",
]);

const labeledKinds = new Set([
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "SwitchStatement",
]);

const shorten = (text: string, limit = maxLabel) => {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > limit ? `${compact.slice(0, limit - 1)}…` : compact;
};

const statementsOf = (node: MaybeNode): TSESTree.Node[] =>
  !node ? [] : node.type === "BlockStatement" ? node.body : [node];

const linesOf = (parts: readonly MaybeNode[]) => {
  const present = parts.filter((part) => part !== null && part !== undefined);
  return {
    start: Math.min(...present.map((part) => part.loc.start.line)),
    end: Math.max(...present.map((part) => part.loc.end.line)),
  };
};

export const buildLogic = (input: LogicInput): FunctionLogic => {
  const { fn, keys, code, file } = input;
  const nodes: LogicNode[] = [];
  const edges: LogicEdge[] = [];
  const breaks: BreakTarget[] = [];
  const continues: ContinueTarget[] = [];
  const context: { region: string | null; catchTarget: string | null; label: string | null } = {
    region: null,
    catchTarget: null,
    label: null,
  };

  const text = (node: MaybeNode) => (node ? code.slice(node.range[0], node.range[1]) : "");
  const own = (node: MaybeNode) => (!node ? [] : [node, ...descendants(node, keys, isOwnershipBoundary)]);
  const callsIn = (parts: readonly MaybeNode[]) =>
    [
      ...new Set(
        parts
          .flatMap(own)
          .flatMap((node) => (node.type === "CallExpression" || node.type === "NewExpression" ? [node] : []))
          .map((node) => `${node.type === "NewExpression" ? "new " : ""}${shorten(text(node.callee), 40)}`),
      ),
    ].slice(0, 8);
  const nestedIn = (parts: readonly MaybeNode[]) =>
    parts
      .flatMap((part) => (part && isFunction(part) ? [part] : part ? descendants(part, keys, isFunction) : []))
      .filter(isFunction)
      .map((nested) => functionId(locationOf(nested, file)));
  const awaitsIn = (parts: readonly MaybeNode[]) =>
    parts
      .flatMap(own)
      .some((node) => node.type === "AwaitExpression" || (node.type === "ForOfStatement" && node.await));

  const addNode = (
    kind: LogicNodeKind,
    label: string,
    parts: readonly MaybeNode[],
    weight: number,
    entry: readonly Pending[],
    scan: readonly MaybeNode[] = parts,
  ): string => {
    const id = `n${nodes.length}`;

    nodes.push({
      id,
      kind,
      label,
      lines: linesOf(parts),
      weight,
      calls: callsIn(scan),
      nested: nestedIn(scan),
      region: context.region,
      unreachable: kind !== "start" && entry.length === 0,
      awaits: awaitsIn(scan),
    });

    connect(entry, id);

    return id;
  };

  const connect = (entry: readonly Pending[], to: string, override?: { label: string; kind: LogicEdgeKind }) =>
    entry.forEach((pending) => {
      edges.push({
        id: `e${edges.length}`,
        from: pending.from,
        to,
        label: override ? [pending.label, override.label].filter(Boolean).join(" · ") : pending.label,
        kind: override?.kind ?? pending.kind,
      });
    });

  const inRegion = <T>(region: string, run: () => T): T => {
    const previous = context.region;

    context.region = region;
    const result = run();
    context.region = previous;

    return result;
  };

  const takeLabel = () => {
    const label = context.label;
    context.label = null;

    return label;
  };

  const simpleRun = (statements: readonly TSESTree.Node[], entry: Pending[]): Built => {
    const previews = statements.map((statement) => shorten(text(statement), 48));
    const label = [
      ...previews.slice(0, blockPreviewLines),
      ...(previews.length > blockPreviewLines ? [`… +${previews.length - blockPreviewLines} more`] : []),
    ].join("\n");
    const weight = statements.reduce((sum, statement) => sum + decisionsIn(statement, keys), 0);
    const id = addNode("block", label, statements, weight, entry);

    const calls = callsIn(statements);
    const declared = statements.flatMap((statement) =>
      statement.type === "VariableDeclaration"
        ? statement.declarations.map((declaration) => shorten(text(declaration.id), 24))
        : statement.type === "FunctionDeclaration"
          ? [`${statement.id?.name ?? "function"}()`]
          : [],
    );
    const summary =
      calls.length > 0
        ? `${awaitsIn(statements) ? "Await / call" : "Call"} ${calls.slice(0, 4).join(", ")}${calls.length > 4 ? "…" : ""}`
        : declared.length > 0
          ? `Set ${declared.slice(0, 4).join(", ")}${declared.length > 4 ? "…" : ""}`
          : shorten(previews[0] ?? "", 60);

    return { exits: [{ from: id, label: "", kind: "normal" }], outline: [{ text: summary, nodeId: id, children: [] }] };
  };

  const sequence = (statements: readonly TSESTree.Node[], entry: Pending[]): Built => {
    const step = (remaining: readonly TSESTree.Node[], current: Pending[], outline: LogicOutlineItem[]): Built => {
      const [first] = remaining;

      if (!first) return { exits: current, outline };

      const simpleCount = remaining.findIndex((statement) => !simpleKinds.has(statement.type));
      const run = simpleCount === -1 ? remaining.length : simpleCount;

      if (run > 0) {
        const meaningful = remaining.slice(0, run).filter((statement) => statement.type !== "EmptyStatement");
        const built = meaningful.length > 0 ? simpleRun(meaningful, current) : { exits: current, outline: [] };

        return step(remaining.slice(run), built.exits, [...outline, ...built.outline]);
      }

      const built = buildStatement(first, current);

      return step(remaining.slice(1), built.exits, [...outline, ...built.outline]);
    };
    return step(statements, entry, []);
  };

  const ifStatement = (node: TSESTree.IfStatement, entry: Pending[]): Built => {
    const condition = shorten(text(node.test));
    const id = addNode("decision", `if (${condition})`, [node.test], 1 + decisionsIn(node.test, keys), entry);

    const alternate = node.alternate;
    const then = inRegion(id, () =>
      sequence(statementsOf(node.consequent), [{ from: id, label: "true", kind: "true" }]),
    );
    const otherwise: Built = alternate
      ? inRegion(id, () => buildStatement(alternate, [{ from: id, label: "false", kind: "false" }]))
      : { exits: [{ from: id, label: "false", kind: "false" }], outline: [] };
    const elseOutline =
      alternate?.type === "IfStatement"
        ? otherwise.outline.map((item, index) =>
            index === 0 ? { ...item, text: item.text.replace(/^If /, "Else if ") } : item,
          )
        : alternate
          ? [{ text: "Otherwise", nodeId: null, children: otherwise.outline }]
          : [];

    return {
      exits: [...then.exits, ...otherwise.exits],
      outline: [{ text: `If ${condition}`, nodeId: id, children: then.outline }, ...elseOutline],
    };
  };

  const loopHeader = (node: Loop) => {
    if (node.type === "ForStatement") {
      return `for (${shorten(text(node.init), 30)}; ${shorten(text(node.test), 30)}; ${shorten(text(node.update), 20)})`;
    }

    if (node.type === "WhileStatement") return `while (${shorten(text(node.test))})`;

    const keyword = node.type === "ForInStatement" ? "in" : "of";
    const awaits = node.type === "ForOfStatement" && node.await;

    return `for${awaits ? " await" : ""} (${shorten(text(node.left), 30)} ${keyword} ${shorten(text(node.right), 40)})`;
  };

  const loopOutline = (node: Loop) => {
    if (node.type === "WhileStatement") return `While ${shorten(text(node.test))}`;
    if (node.type === "ForStatement") return `Loop: ${loopHeader(node)}`;

    return `For each ${shorten(text(node.left), 30)} ${node.type === "ForInStatement" ? "in" : "of"} ${shorten(text(node.right), 40)}`;
  };

  const loop = (node: Loop, entry: Pending[]): Built => {
    const label = takeLabel();
    const header =
      node.type === "ForStatement"
        ? [node.init, node.test, node.update]
        : node.type === "WhileStatement"
          ? [node.test]
          : [node.left, node.right];
    const weight = 1 + header.reduce((sum, part) => sum + decisionsIn(part, keys), 0);
    const id = addNode("loop", loopHeader(node), header, weight, entry);
    const iterates = node.type === "ForInStatement" || node.type === "ForOfStatement";
    const breakTarget: BreakTarget = { label, kind: "loop", collected: [] };

    breaks.push(breakTarget);
    continues.push({ label, target: id, collected: [] });
    const body = inRegion(id, () =>
      sequence(statementsOf(node.body), [{ from: id, label: iterates ? "each" : "true", kind: "true" }]),
    );
    continues.pop();
    breaks.pop();
    connect(body.exits, id, { label: "next", kind: "back" });

    return {
      exits: [{ from: id, label: iterates ? "done" : "false", kind: "false" }, ...breakTarget.collected],
      outline: [{ text: loopOutline(node), nodeId: id, children: body.outline }],
    };
  };

  const doWhile = (node: TSESTree.DoWhileStatement, entry: Pending[]): Built => {
    const label = takeLabel();
    const breakTarget: BreakTarget = { label, kind: "loop", collected: [] };
    const continueTarget: ContinueTarget = { label, target: null, collected: [] };

    breaks.push(breakTarget);
    continues.push(continueTarget);
    const firstIndex = nodes.length;
    const body = sequence(statementsOf(node.body), entry);
    continues.pop();
    breaks.pop();

    const condition = shorten(text(node.test));
    const id = addNode("decision", `while (${condition})`, [node.test], 1 + decisionsIn(node.test, keys), [
      ...body.exits,
      ...continueTarget.collected,
    ]);
    const first = nodes[firstIndex];

    if (first && first.id !== id) connect([{ from: id, label: "true", kind: "back" }], first.id);

    return {
      exits: [{ from: id, label: "false", kind: "false" }, ...breakTarget.collected],
      outline: [{ text: `Repeat while ${condition}`, nodeId: id, children: body.outline }],
    };
  };

  const switchStatement = (node: TSESTree.SwitchStatement, entry: Pending[]): Built => {
    const { discriminant, cases } = node;
    const weight =
      decisionsIn(discriminant, keys) +
      cases.reduce((sum, item) => sum + (item.test ? 1 + decisionsIn(item.test, keys) : 0), 0);
    const id = addNode(
      "switch",
      `switch (${shorten(text(discriminant))})`,
      [discriminant, ...cases.map((item) => item.test)],
      weight,
      entry,
    );
    const breakTarget: BreakTarget = { label: takeLabel(), kind: "switch", collected: [] };

    breaks.push(breakTarget);
    const result = cases.reduce<Built>(
      (state, item) => {
        const caseLabel = item.test ? `case ${shorten(text(item.test), 30)}` : "default";
        const built = inRegion(id, () =>
          sequence(item.consequent, [{ from: id, label: caseLabel, kind: "case" }, ...state.exits]),
        );

        return {
          exits: built.exits,
          outline: [
            ...state.outline,
            {
              text: item.test ? `Case ${shorten(text(item.test), 40)}` : "Default",
              nodeId: null,
              children: built.outline,
            },
          ],
        };
      },
      { exits: [], outline: [] },
    );
    breaks.pop();

    const hasDefault = cases.some((item) => !item.test);
    const noMatch: Pending[] = hasDefault ? [] : [{ from: id, label: "no match", kind: "false" }];

    return {
      exits: [...result.exits, ...breakTarget.collected, ...noMatch],
      outline: [{ text: `Depending on ${shorten(text(discriminant))}`, nodeId: id, children: result.outline }],
    };
  };

  const tryStatement = (node: TSESTree.TryStatement, entry: Pending[]): Built => {
    const { handler, finalizer, block } = node;
    const param = handler?.param;
    const paramText = param ? ` (${shorten(text(param), 30)})` : "";
    const id = addNode("try", "try", [block], 0, entry, []);
    const catchId = handler
      ? addNode(
          "catch",
          `catch${paramText}`,
          [handler],
          1 + decisionsIn(param, keys),
          [{ from: id, label: "on error", kind: "exception" }],
          [param],
        )
      : null;
    const previousCatch = context.catchTarget;

    context.catchTarget = catchId ?? previousCatch;
    const body = inRegion(id, () => sequence(statementsOf(block), [{ from: id, label: "", kind: "normal" }]));
    context.catchTarget = previousCatch;

    const caught =
      handler && catchId
        ? inRegion(id, () => sequence(statementsOf(handler.body), [{ from: catchId, label: "", kind: "normal" }]))
        : null;
    const before = [...body.exits, ...(caught?.exits ?? [])];
    const finallyBuilt = finalizer
      ? (() => {
          const finallyId = addNode(
            "finally",
            "finally",
            [finalizer],
            0,
            [...before, { from: id, label: "always runs", kind: "break" }],
            [],
          );
          return {
            id: finallyId,
            built: inRegion(id, () =>
              sequence(statementsOf(finalizer), [{ from: finallyId, label: "", kind: "normal" }]),
            ),
          };
        })()
      : null;

    return {
      exits: finallyBuilt ? (before.length > 0 ? finallyBuilt.built.exits : []) : before,
      outline: [
        { text: "Try", nodeId: id, children: body.outline },
        ...(caught && catchId ? [{ text: `If it fails${paramText}`, nodeId: catchId, children: caught.outline }] : []),
        ...(finallyBuilt
          ? [{ text: "Finally (always runs)", nodeId: finallyBuilt.id, children: finallyBuilt.built.outline }]
          : []),
      ],
    };
  };

  const terminal = (node: TSESTree.ReturnStatement | TSESTree.ThrowStatement, entry: Pending[]): Built => {
    const argument = node.argument;
    const kind = node.type === "ReturnStatement" ? "return" : "throw";
    const label = `${kind}${argument ? ` ${shorten(text(argument), 60)}` : ""}`;
    const id = addNode(kind, label, [node], decisionsIn(argument, keys), entry, [argument]);

    if (kind === "throw" && context.catchTarget)
      connect([{ from: id, label: "caught", kind: "exception" }], context.catchTarget);

    return {
      exits: [],
      outline: [
        {
          text:
            kind === "return"
              ? `Return ${argument ? shorten(text(argument), 60) : "(nothing)"}`
              : `Throw ${shorten(text(argument), 60)}`,
          nodeId: id,
          children: [],
        },
      ],
    };
  };

  const jump = (node: TSESTree.BreakStatement | TSESTree.ContinueStatement, entry: Pending[]): Built => {
    const label = node.label?.name ?? null;

    if (node.type === "BreakStatement") {
      const target = breaks
        .toReversed()
        .find((candidate) => (label ? candidate.label === label : candidate.kind !== "label"));

      target?.collected.push(
        ...entry.map((pending) => ({
          ...pending,
          label: [pending.label, "break"].filter(Boolean).join(" · "),
          kind: "break" as const,
        })),
      );

      return {
        exits: [],
        outline: [
          { text: target?.kind === "switch" ? "Leave the switch" : "Stop the loop", nodeId: null, children: [] },
        ],
      };
    }

    const target = continues.toReversed().find((candidate) => (label ? candidate.label === label : true));

    if (target?.target) connect(entry, target.target, { label: "continue", kind: "back" });
    else
      target?.collected.push(
        ...entry.map((pending) => ({
          ...pending,
          label: [pending.label, "continue"].filter(Boolean).join(" · "),
          kind: "back" as const,
        })),
      );

    return { exits: [], outline: [{ text: "Skip to the next iteration", nodeId: null, children: [] }] };
  };

  const labeled = (node: TSESTree.LabeledStatement, entry: Pending[]): Built => {
    const label = node.label.name;

    if (labeledKinds.has(node.body.type)) {
      context.label = label;
      return buildStatement(node.body, entry);
    }

    const target: BreakTarget = { label, kind: "label", collected: [] };

    breaks.push(target);
    const built = sequence(statementsOf(node.body), entry);
    breaks.pop();

    return { exits: [...built.exits, ...target.collected], outline: built.outline };
  };

  function buildStatement(node: TSESTree.Node, entry: Pending[]): Built {
    switch (node.type) {
      case "BlockStatement":
        return sequence(statementsOf(node), entry);
      case "IfStatement":
        return ifStatement(node, entry);
      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement":
      case "WhileStatement":
        return loop(node, entry);
      case "DoWhileStatement":
        return doWhile(node, entry);
      case "SwitchStatement":
        return switchStatement(node, entry);
      case "TryStatement":
        return tryStatement(node, entry);
      case "ReturnStatement":
      case "ThrowStatement":
        return terminal(node, entry);
      case "BreakStatement":
      case "ContinueStatement":
        return jump(node, entry);
      case "LabeledStatement":
        return labeled(node, entry);
      default:
        return simpleRun([node], entry);
    }
  }

  const params = fn.params;
  const paramText = shorten(params.map(text).join(", "), 50);
  const start = addNode(
    "start",
    `${input.name}(${paramText})`,
    [fn],
    params.reduce((sum, param) => sum + decisionsIn(param, keys), 0),
    [],
    params,
  );
  const body = fn.body;
  const built: Built =
    body.type === "BlockStatement"
      ? sequence(statementsOf(body), [{ from: start, label: "", kind: "normal" }])
      : (() => {
          const id = addNode("return", `return ${shorten(text(body), 60)}`, [body], decisionsIn(body, keys), [
            { from: start, label: "", kind: "normal" },
          ]);
          return { exits: [], outline: [{ text: `Return ${shorten(text(body), 60)}`, nodeId: id, children: [] }] };
        })();

  const reachableFrom = (seen: Set<string>, frontier: readonly string[]): Set<string> => {
    const next = edges.filter((edge) => frontier.includes(edge.from) && !seen.has(edge.to)).map((edge) => edge.to);
    const fresh = [...new Set(next)];

    fresh.forEach((id) => seen.add(id));

    return fresh.length === 0 ? seen : reachableFrom(seen, fresh);
  };

  const reachedBeforeEnd = reachableFrom(new Set([start]), [start]);

  if (built.exits.some((exit) => reachedBeforeEnd.has(exit.from))) {
    const endId = addNode("end", "end of function", [], 0, built.exits);
    const endNode = nodes.find((node) => node.id === endId);

    if (endNode) endNode.lines = { start: fn.loc.end.line, end: fn.loc.end.line };
  }

  const reachable = reachableFrom(new Set([start]), [start]);

  nodes.forEach((node) => {
    node.unreachable = !reachable.has(node.id);
  });

  const firstLine = fn.loc.start.line;
  const lastLine = fn.loc.end.line;

  return {
    functionId: functionId(locationOf(fn, file)),
    name: input.name,
    file,
    complexity: input.complexity,
    nodes,
    edges,
    outline: built.outline,
    source: { firstLine, lines: code.split("\n").slice(firstLine - 1, lastLine) },
  };
};

export type MarkupInput = {
  id: string;
  name: string;
  file: string;
  code: string;
  complexity: number;
  owned: readonly TSESTree.Node[];
  lines: { start: number; end: number };
};

const markupKinds: Readonly<Record<string, LogicNodeKind>> = {
  SvelteEachBlock: "loop",
  SvelteAwaitCatchBlock: "catch",
};

const markupNode = (id: string, kind: LogicNodeKind, label: string, line: number, weight: number): LogicNode => ({
  id,
  kind,
  label,
  lines: { start: line, end: line },
  weight,
  calls: [],
  nested: [],
  region: null,
  unreachable: false,
  awaits: false,
});

export const buildMarkupLogic = (input: MarkupInput): FunctionLogic => {
  const source = input.code.split("\n");
  const weighted = input.owned
    .filter((node) => decisionWeight(node) > 0)
    .reduce((map, node) => {
      const line = node.loc.start.line;
      const known = map.get(line);

      return map.set(line, {
        weight: (known?.weight ?? 0) + decisionWeight(node),
        kind: known?.kind ?? markupKinds[node.type] ?? "decision",
      });
    }, new Map<number, { weight: number; kind: LogicNodeKind }>());
  const steps = [...weighted].toSorted(([a], [b]) => a - b);
  const nodes = [
    markupNode("n0", "start", input.name, input.lines.start, 0),
    ...steps.map(([line, step], index) =>
      markupNode(`n${index + 1}`, step.kind, shorten(source[line - 1] ?? ""), line, step.weight),
    ),
    markupNode(`n${steps.length + 1}`, "end", "end of template", input.lines.end, 0),
  ];
  const edges: LogicEdge[] = nodes.slice(1).map((target, index) => ({
    id: `e${index}`,
    from: nodes[index]?.id ?? "n0",
    to: target.id,
    label: "",
    kind: "normal",
  }));

  return {
    functionId: input.id,
    name: input.name,
    file: input.file,
    complexity: input.complexity,
    nodes,
    edges,
    outline: nodes
      .filter((entry) => entry.weight > 0)
      .map((entry) => ({ text: entry.label, nodeId: entry.id, children: [] })),
    source: { firstLine: input.lines.start, lines: source.slice(input.lines.start - 1, input.lines.end) },
  };
};
