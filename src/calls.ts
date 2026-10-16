import {
  type AstNode,
  type VisitorKeys,
  field,
  isFunction,
  locationOf,
  stringField,
  unwrapExpression,
} from "./ast";
import { ownNodes } from "./metrics";
import type { CallEdge, Location } from "./model";

type ScopeDefinition = { type: string; node: unknown; name?: unknown };
type ScopeVariable = {
  defs: ScopeDefinition[];
  references: { isWrite(): boolean }[];
};
type ScopeReference = { identifier: unknown; resolved: ScopeVariable | null };
export type ScopeManagerLike = { scopes: { references: ScopeReference[] }[] };

type ThisContext = { cls: AstNode; isStatic: boolean };

export type CallContext = {
  file: string;
  keys: VisitorKeys;
  parents: ReadonlyMap<AstNode, AstNode>;
  scope: ScopeManagerLike;
  functionIds: ReadonlyMap<AstNode, string>;
};

const referenceIndex = (scope: ScopeManagerLike): Map<unknown, ScopeReference> =>
  new Map(
    scope.scopes.flatMap((s) => s.references.map((reference) => [reference.identifier, reference])),
  );

const runtimeDefinitions = (variable: ScopeVariable) =>
  variable.defs.filter((def) => (def.node as AstNode | undefined)?.type !== "TSDeclareFunction");

const declaredFunction = (variable: ScopeVariable): AstNode | undefined => {
  const defs = runtimeDefinitions(variable);
  const def = defs[0];
  if (defs.length !== 1 || def === undefined) return undefined;
  const node = def.node as AstNode;
  if (def.type === "FunctionName") return isFunction(node) ? node : undefined;
  if (def.type !== "Variable" || node.type !== "VariableDeclarator") return undefined;
  const init = unwrapExpression(field(node, "init"));
  const writes = variable.references.filter((reference) => reference.isWrite()).length;
  return field(node, "id") === def.name && init && isFunction(init) && writes <= 1
    ? init
    : undefined;
};

const memberName = (key: AstNode | undefined): string | undefined =>
  key?.type === "Identifier"
    ? stringField(key, "name")
    : key?.type === "PrivateIdentifier"
      ? `#${stringField(key, "name")}`
      : undefined;

const classMembers = (cls: AstNode): Map<string, AstNode[]> =>
  ((field(cls, "body")?.body as AstNode[] | undefined) ?? [])
    .filter((member) => member.computed !== true)
    .flatMap((member) => {
      const value = unwrapExpression(field(member, "value"));
      const name = memberName(field(member, "key"));
      const callable =
        (member.type === "MethodDefinition" && member.kind === "method") ||
        member.type === "PropertyDefinition";
      return callable && value && isFunction(value) && name !== undefined
        ? [[`${member.static === true}:${name}`, value] as const]
        : [];
    })
    .reduce(
      (map, [key, value]) => map.set(key, [...(map.get(key) ?? []), value]),
      new Map<string, AstNode[]>(),
    );

const methodContext = (fn: AstNode, parents: ReadonlyMap<AstNode, AstNode>) => {
  const member = parents.get(fn);
  const cls = member && parents.get(parents.get(member) as AstNode);
  return member?.type === "MethodDefinition" && cls
    ? { cls, isStatic: member.static === true }
    : null;
};

const thisContext = (node: AstNode, parents: ReadonlyMap<AstNode, AstNode>): ThisContext | null => {
  const parent = parents.get(node);
  if (!parent) return null;
  if (parent.type === "ArrowFunctionExpression") return thisContext(parent, parents);
  if (isFunction(parent)) return methodContext(parent, parents);
  if (parent.type === "PropertyDefinition" || parent.type === "StaticBlock") {
    const cls = parents.get(parents.get(parent) as AstNode);
    return cls ? { cls, isStatic: parent.type === "StaticBlock" || parent.static === true } : null;
  }
  return thisContext(parent, parents);
};

const contextOfFunction = (fn: AstNode, parents: ReadonlyMap<AstNode, AstNode>) =>
  fn.type === "ArrowFunctionExpression" ? thisContext(fn, parents) : methodContext(fn, parents);

export const resolveLocalCalls = (
  functions: readonly AstNode[],
  context: CallContext,
): CallEdge[] => {
  const references = referenceIndex(context.scope);
  const membersByClass = new Map<AstNode, Map<string, AstNode[]>>();
  const membersOf = (cls: AstNode) => {
    const cached = membersByClass.get(cls);
    if (cached) return cached;
    const members = classMembers(cls);
    membersByClass.set(cls, members);
    return members;
  };

  const calleeTarget = (call: AstNode, self: ThisContext | null): AstNode | undefined => {
    const callee = unwrapExpression(field(call, "callee"));
    if (callee?.type === "Identifier") {
      const resolved = references.get(callee)?.resolved;
      return resolved ? declaredFunction(resolved) : undefined;
    }
    if (
      self &&
      callee?.type === "MemberExpression" &&
      callee.computed !== true &&
      field(callee, "object")?.type === "ThisExpression"
    ) {
      const name = memberName(field(callee, "property"));
      const candidates = membersOf(self.cls).get(`${self.isStatic}:${name}`) ?? [];
      return candidates.length === 1 ? candidates[0] : undefined;
    }
    return undefined;
  };

  const sites = functions.flatMap((fn) => {
    const from = context.functionIds.get(fn);
    const self = contextOfFunction(fn, context.parents);
    return from === undefined
      ? []
      : ownNodes(fn, context.keys)
          .filter((node) => node.type === "CallExpression")
          .flatMap((call) => {
            const target = calleeTarget(call, self);
            const to = target && context.functionIds.get(target);
            return to === undefined
              ? []
              : [{ from, to, location: locationOf(call, context.file) }];
          });
  });

  const grouped = sites.reduce(
    (map, site) => {
      const key = `${site.from}\u0000${site.to}`;
      const existing = map.get(key);
      return map.set(key, {
        kind: "calls" as const,
        from: site.from,
        to: site.to,
        occurrences: [...(existing?.occurrences ?? []), site.location] as Location[],
      });
    },
    new Map<string, CallEdge>(),
  );
  return [...grouped.values()];
};
