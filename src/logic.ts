import { type AstNode, type VisitorKeys, descendants, field, isFunction, locationOf, stringField } from "./ast";
import { decisionsIn, isOwnershipBoundary } from "./metrics";
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

export type LogicInput = {
  fn: AstNode;
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

const shorten = (text: string, limit = maxLabel) => {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > limit ? `${compact.slice(0, limit - 1)}…` : compact;
};

const statementsOf = (node: AstNode | undefined): AstNode[] =>
  !node ? [] : node.type === "BlockStatement" ? ((node.body as AstNode[] | undefined) ?? []) : [node];

export const buildLogic = (input: LogicInput): FunctionLogic => {
  const { fn, keys, code, file } = input;
  const nodes: LogicNode[] = [];
  const edges: LogicEdge[] = [];
  const breaks: BreakTarget[] = [];
  const continues: ContinueTarget[] = [];
  const context = { region: null as string | null, catchTarget: null as string | null, label: null as string | null };

  const text = (node: AstNode | undefined) => {
    const range = node?.range as [number, number] | undefined;
    return range ? code.slice(range[0], range[1]) : "";
  };
  const own = (node: AstNode | undefined) =>
    !node ? [] : [node, ...descendants(node, keys, isOwnershipBoundary)];
  const callsIn = (parts: readonly (AstNode | undefined)[]) =>
    [
      ...new Set(
        parts
          .flatMap(own)
          .filter((node) => node.type === "CallExpression" || node.type === "NewExpression")
          .map((node) => `${node.type === "NewExpression" ? "new " : ""}${shorten(text(field(node, "callee")), 40)}`),
      ),
    ].slice(0, 8);
  const nestedIn = (parts: readonly (AstNode | undefined)[]) =>
    parts
      .flatMap((part) => (part && isFunction(part) ? [part] : part ? descendants(part, keys, isFunction) : []))
      .filter(isFunction)
      .map((nested) => functionId(locationOf(nested, file)));
  const awaitsIn = (parts: readonly (AstNode | undefined)[]) =>
    parts.flatMap(own).some((node) => node.type === "AwaitExpression" || (node.type === "ForOfStatement" && node.await === true));
  const linesOf = (parts: readonly (AstNode | undefined)[]) => {
    const present = parts.filter((part): part is AstNode => part !== undefined && part.loc !== undefined);
    return {
      start: Math.min(...present.map((part) => part.loc?.start.line ?? 0)),
      end: Math.max(...present.map((part) => part.loc?.end.line ?? 0)),
    };
  };

  const addNode = (
    kind: LogicNodeKind,
    label: string,
    parts: readonly (AstNode | undefined)[],
    weight: number,
    entry: readonly Pending[],
    scan: readonly (AstNode | undefined)[] = parts,
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

  const simpleRun = (statements: readonly AstNode[], entry: Pending[]): Built => {
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
        ? ((statement.declarations as AstNode[] | undefined) ?? []).map((declaration) => shorten(text(field(declaration, "id")), 24))
        : statement.type === "FunctionDeclaration"
          ? [`${stringField(field(statement, "id") ?? { type: "" }, "name") ?? "function"}()`]
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

  const sequence = (statements: readonly AstNode[], entry: Pending[]): Built => {
    const step = (remaining: readonly AstNode[], current: Pending[], outline: LogicOutlineItem[]): Built => {
      if (remaining.length === 0) return { exits: current, outline };
      const simpleCount = remaining.findIndex((statement) => !simpleKinds.has(statement.type));
      const run = simpleCount === -1 ? remaining.length : simpleCount;
      if (run > 0) {
        const meaningful = remaining.slice(0, run).filter((statement) => statement.type !== "EmptyStatement");
        const built = meaningful.length > 0 ? simpleRun(meaningful, current) : { exits: current, outline: [] };
        return step(remaining.slice(run), built.exits, [...outline, ...built.outline]);
      }
      const built = statement(remaining[0] as AstNode, current);
      return step(remaining.slice(1), built.exits, [...outline, ...built.outline]);
    };
    return step(statements, entry, []);
  };

  const ifStatement = (node: AstNode, entry: Pending[]): Built => {
    const test = field(node, "test");
    const condition = shorten(text(test));
    const id = addNode("decision", `if (${condition})`, [test], 1 + decisionsIn(test, keys), entry);
    const alternate = field(node, "alternate");
    const then = inRegion(id, () => sequence(statementsOf(field(node, "consequent")), [{ from: id, label: "true", kind: "true" }]));
    const otherwise = alternate
      ? inRegion(id, () => statement(alternate, [{ from: id, label: "false", kind: "false" }]))
      : { exits: [{ from: id, label: "false", kind: "false" as const }], outline: [] };
    const elseOutline =
      alternate?.type === "IfStatement"
        ? otherwise.outline.map((item, index) => (index === 0 ? { ...item, text: item.text.replace(/^If /, "Else if ") } : item))
        : alternate
          ? [{ text: "Otherwise", nodeId: null, children: otherwise.outline }]
          : [];
    return {
      exits: [...then.exits, ...otherwise.exits],
      outline: [{ text: `If ${condition}`, nodeId: id, children: then.outline }, ...elseOutline],
    };
  };

  const loopHeader = (node: AstNode) => {
    if (node.type === "ForStatement") {
      return `for (${shorten(text(field(node, "init")), 30)}; ${shorten(text(field(node, "test")), 30)}; ${shorten(text(field(node, "update")), 20)})`;
    }
    if (node.type === "WhileStatement") return `while (${shorten(text(field(node, "test")))})`;
    const keyword = node.type === "ForInStatement" ? "in" : "of";
    return `for${node.await === true ? " await" : ""} (${shorten(text(field(node, "left")), 30)} ${keyword} ${shorten(text(field(node, "right")), 40)})`;
  };

  const loopOutline = (node: AstNode) => {
    if (node.type === "WhileStatement") return `While ${shorten(text(field(node, "test")))}`;
    if (node.type === "ForStatement") return `Loop: ${loopHeader(node)}`;
    return `For each ${shorten(text(field(node, "left")), 30)} ${node.type === "ForInStatement" ? "in" : "of"} ${shorten(text(field(node, "right")), 40)}`;
  };

  const loop = (node: AstNode, entry: Pending[]): Built => {
    const label = takeLabel();
    const header = [field(node, "init"), field(node, "test"), field(node, "update"), field(node, "left"), field(node, "right")];
    const weight = 1 + header.reduce((sum, part) => sum + decisionsIn(part, keys), 0);
    const id = addNode("loop", loopHeader(node), header, weight, entry);
    const iterates = node.type === "ForInStatement" || node.type === "ForOfStatement";
    const breakTarget: BreakTarget = { label, kind: "loop", collected: [] };
    breaks.push(breakTarget);
    continues.push({ label, target: id, collected: [] });
    const body = inRegion(id, () =>
      sequence(statementsOf(field(node, "body")), [{ from: id, label: iterates ? "each" : "true", kind: "true" }]),
    );
    continues.pop();
    breaks.pop();
    connect(body.exits, id, { label: "next", kind: "back" });
    return {
      exits: [{ from: id, label: iterates ? "done" : "false", kind: "false" }, ...breakTarget.collected],
      outline: [{ text: loopOutline(node), nodeId: id, children: body.outline }],
    };
  };

  const doWhile = (node: AstNode, entry: Pending[]): Built => {
    const label = takeLabel();
    const breakTarget: BreakTarget = { label, kind: "loop", collected: [] };
    const continueTarget: ContinueTarget = { label, target: null, collected: [] };
    breaks.push(breakTarget);
    continues.push(continueTarget);
    const firstIndex = nodes.length;
    const body = sequence(statementsOf(field(node, "body")), entry);
    continues.pop();
    breaks.pop();
    const test = field(node, "test");
    const condition = shorten(text(test));
    const id = addNode("decision", `while (${condition})`, [test], 1 + decisionsIn(test, keys), [...body.exits, ...continueTarget.collected]);
    const first = nodes[firstIndex];
    if (first && first.id !== id) connect([{ from: id, label: "true", kind: "back" }], first.id);
    return {
      exits: [{ from: id, label: "false", kind: "false" }, ...breakTarget.collected],
      outline: [{ text: `Repeat while ${condition}`, nodeId: id, children: body.outline }],
    };
  };

  const switchStatement = (node: AstNode, entry: Pending[]): Built => {
    const discriminant = field(node, "discriminant");
    const cases = (node.cases as AstNode[] | undefined) ?? [];
    const weight =
      decisionsIn(discriminant, keys) +
      cases.reduce((sum, item) => sum + (field(item, "test") ? 1 + decisionsIn(field(item, "test"), keys) : 0), 0);
    const id = addNode("switch", `switch (${shorten(text(discriminant))})`, [discriminant, ...cases.map((item) => field(item, "test"))], weight, entry);
    const breakTarget: BreakTarget = { label: takeLabel(), kind: "switch", collected: [] };
    breaks.push(breakTarget);
    const result = cases.reduce(
      (state, item) => {
        const test = field(item, "test");
        const caseLabel = test ? `case ${shorten(text(test), 30)}` : "default";
        const built = inRegion(id, () =>
          sequence((item.consequent as AstNode[] | undefined) ?? [], [{ from: id, label: caseLabel, kind: "case" }, ...state.fall]),
        );
        return {
          fall: built.exits,
          outline: [...state.outline, { text: test ? `Case ${shorten(text(test), 40)}` : "Default", nodeId: null, children: built.outline }],
        };
      },
      { fall: [] as Pending[], outline: [] as LogicOutlineItem[] },
    );
    breaks.pop();
    const hasDefault = cases.some((item) => !field(item, "test"));
    return {
      exits: [...result.fall, ...breakTarget.collected, ...(hasDefault ? [] : [{ from: id, label: "no match", kind: "false" as const }])],
      outline: [{ text: `Depending on ${shorten(text(discriminant))}`, nodeId: id, children: result.outline }],
    };
  };

  const tryStatement = (node: AstNode, entry: Pending[]): Built => {
    const handler = field(node, "handler");
    const finalizer = field(node, "finalizer");
    const block = field(node, "block");
    const id = addNode("try", "try", [block], 0, entry, []);
    const catchId = handler
      ? addNode(
          "catch",
          `catch${field(handler, "param") ? ` (${shorten(text(field(handler, "param")), 30)})` : ""}`,
          [handler],
          1 + decisionsIn(field(handler, "param"), keys),
          [{ from: id, label: "on error", kind: "exception" }],
          [field(handler, "param")],
        )
      : null;
    const previousCatch = context.catchTarget;
    context.catchTarget = catchId ?? previousCatch;
    const body = inRegion(id, () => sequence(statementsOf(block), [{ from: id, label: "", kind: "normal" }]));
    context.catchTarget = previousCatch;
    const caught = handler && catchId ? inRegion(id, () => sequence(statementsOf(field(handler, "body")), [{ from: catchId, label: "", kind: "normal" }])) : null;
    const before = [...body.exits, ...(caught?.exits ?? [])];
    const finallyBuilt = finalizer
      ? (() => {
          const finallyId = addNode("finally", "finally", [finalizer], 0, [...before, { from: id, label: "always runs", kind: "break" }], []);
          return { id: finallyId, built: inRegion(id, () => sequence(statementsOf(finalizer), [{ from: finallyId, label: "", kind: "normal" }])) };
        })()
      : null;
    return {
      exits: finallyBuilt ? (before.length > 0 ? finallyBuilt.built.exits : []) : before,
      outline: [
        { text: "Try", nodeId: id, children: body.outline },
        ...(caught && catchId ? [{ text: `If it fails${handler && field(handler, "param") ? ` (${shorten(text(field(handler, "param")), 30)})` : ""}`, nodeId: catchId, children: caught.outline }] : []),
        ...(finallyBuilt ? [{ text: "Finally (always runs)", nodeId: finallyBuilt.id, children: finallyBuilt.built.outline }] : []),
      ],
    };
  };

  const terminal = (node: AstNode, entry: Pending[]): Built => {
    const argument = field(node, "argument");
    const kind = node.type === "ReturnStatement" ? "return" : "throw";
    const label = `${kind}${argument ? ` ${shorten(text(argument), 60)}` : ""}`;
    const id = addNode(kind, label, [node], decisionsIn(argument, keys), entry, [argument]);
    if (kind === "throw" && context.catchTarget) connect([{ from: id, label: "caught", kind: "exception" }], context.catchTarget);
    return {
      exits: [],
      outline: [{ text: kind === "return" ? `Return ${argument ? shorten(text(argument), 60) : "(nothing)"}` : `Throw ${shorten(text(argument), 60)}`, nodeId: id, children: [] }],
    };
  };

  const jump = (node: AstNode, entry: Pending[]): Built => {
    const label = stringField(field(node, "label") ?? { type: "" }, "name") ?? null;
    if (node.type === "BreakStatement") {
      const target = [...breaks].reverse().find((candidate) => (label ? candidate.label === label : candidate.kind !== "label"));
      target?.collected.push(...entry.map((pending) => ({ ...pending, label: [pending.label, "break"].filter(Boolean).join(" · "), kind: "break" as const })));
      return { exits: [], outline: [{ text: target?.kind === "switch" ? "Leave the switch" : "Stop the loop", nodeId: null, children: [] }] };
    }
    const target = [...continues].reverse().find((candidate) => (label ? candidate.label === label : true));
    if (target?.target) connect(entry, target.target, { label: "continue", kind: "back" });
    else target?.collected.push(...entry.map((pending) => ({ ...pending, label: [pending.label, "continue"].filter(Boolean).join(" · "), kind: "back" as const })));
    return { exits: [], outline: [{ text: "Skip to the next iteration", nodeId: null, children: [] }] };
  };

  const labeled = (node: AstNode, entry: Pending[]): Built => {
    const label = stringField(field(node, "label") ?? { type: "" }, "name") ?? null;
    const body = field(node, "body");
    if (body && ["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement", "SwitchStatement"].includes(body.type)) {
      context.label = label;
      return statement(body, entry);
    }
    const target: BreakTarget = { label, kind: "label", collected: [] };
    breaks.push(target);
    const built = sequence(statementsOf(body), entry);
    breaks.pop();
    return { exits: [...built.exits, ...target.collected], outline: built.outline };
  };

  function statement(node: AstNode, entry: Pending[]): Built {
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

  const params = (fn.params as AstNode[] | undefined) ?? [];
  const paramText = shorten(params.map(text).join(", "), 50);
  const start = addNode(
    "start",
    `${input.name}(${paramText})`,
    [fn],
    params.reduce((sum, param) => sum + decisionsIn(param, keys), 0),
    [],
    params,
  );
  const body = field(fn, "body");
  const built =
    body?.type === "BlockStatement"
      ? sequence(statementsOf(body), [{ from: start, label: "", kind: "normal" }])
      : (() => {
          const id = addNode("return", `return ${shorten(text(body), 60)}`, [body], decisionsIn(body, keys), [{ from: start, label: "", kind: "normal" }]);
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
    if (endNode) endNode.lines = { start: fn.loc?.end.line ?? 0, end: fn.loc?.end.line ?? 0 };
  }
  const reachable = reachableFrom(new Set([start]), [start]);
  nodes.forEach((node) => {
    node.unreachable = !reachable.has(node.id);
  });

  const firstLine = fn.loc?.start.line ?? 1;
  const lastLine = fn.loc?.end.line ?? firstLine;
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
