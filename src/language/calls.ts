import type { Reference, ScopeManager, Variable } from "@typescript-eslint/scope-manager";
import type { TSESTree } from "@typescript-eslint/types";
import { type FunctionLike, type VisitorKeys, isFunction, locationOf, unwrapExpression } from "./ast";
import type { CallEdge } from "../model";
import { ownNodes } from "./complexity";

type ClassNode = TSESTree.ClassDeclaration | TSESTree.ClassExpression;
type ThisContext = { cls: ClassNode; isStatic: boolean };
type Parents = ReadonlyMap<TSESTree.Node, TSESTree.Node>;

export type CallContext = {
  file: string;
  keys: VisitorKeys;
  parents: Parents;
  scope: ScopeManager;
  functionIds: ReadonlyMap<FunctionLike, string>;
};

const referenceIndex = (scope: ScopeManager): Map<TSESTree.Node, Reference> =>
  new Map(scope.scopes.flatMap((s) => s.references.map((reference) => [reference.identifier, reference] as const)));

const declaredFunction = (variable: Variable): FunctionLike | undefined => {
  const defs = variable.defs.filter((def) => def.node.type !== "TSDeclareFunction");
  const [def] = defs;

  if (defs.length !== 1 || def === undefined) return undefined;
  if (def.type === "FunctionName") return isFunction(def.node) ? def.node : undefined;
  if (def.type !== "Variable") return undefined;

  const init = unwrapExpression(def.node.init);
  const writes = variable.references.filter((reference) => reference.isWrite()).length;

  return def.node.id === def.name && init && isFunction(init) && writes <= 1 ? init : undefined;
};

const memberName = (key: TSESTree.Node): string | undefined =>
  key.type === "Identifier" ? key.name : key.type === "PrivateIdentifier" ? `#${key.name}` : undefined;

const classMembers = (cls: ClassNode): Map<string, FunctionLike[]> =>
  cls.body.body
    .flatMap((member) => {
      const callable =
        (member.type === "MethodDefinition" && member.kind === "method") || member.type === "PropertyDefinition"
          ? member
          : undefined;

      if (!callable || callable.computed) return [];

      const value = unwrapExpression(callable.value);
      const name = memberName(callable.key);

      return value && isFunction(value) && name !== undefined ? [[`${callable.static}:${name}`, value] as const] : [];
    })
    .reduce((map, [key, value]) => map.set(key, [...(map.get(key) ?? []), value]), new Map<string, FunctionLike[]>());

/** The class that owns a class member: member → ClassBody → class. */
const classOf = (member: TSESTree.Node, parents: Parents): ClassNode | undefined => {
  const body = parents.get(member);
  const cls = body && parents.get(body);

  return cls?.type === "ClassDeclaration" || cls?.type === "ClassExpression" ? cls : undefined;
};

const methodContext = (fn: TSESTree.Node, parents: Parents): ThisContext | null => {
  const member = parents.get(fn);
  const cls = member?.type === "MethodDefinition" ? classOf(member, parents) : undefined;

  return member?.type === "MethodDefinition" && cls ? { cls, isStatic: member.static } : null;
};

const thisContext = (node: TSESTree.Node, parents: Parents): ThisContext | null => {
  const parent = parents.get(node);

  if (!parent) return null;
  if (parent.type === "ArrowFunctionExpression") return thisContext(parent, parents);
  if (isFunction(parent)) return methodContext(parent, parents);

  if (parent.type === "PropertyDefinition" || parent.type === "StaticBlock") {
    const cls = classOf(parent, parents);
    return cls ? { cls, isStatic: parent.type === "StaticBlock" || parent.static } : null;
  }

  return thisContext(parent, parents);
};

const contextOfFunction = (fn: FunctionLike, parents: Parents) =>
  fn.type === "ArrowFunctionExpression" ? thisContext(fn, parents) : methodContext(fn, parents);

export const resolveLocalCalls = (functions: readonly FunctionLike[], context: CallContext): CallEdge[] => {
  const references = referenceIndex(context.scope);
  const membersByClass = new Map<ClassNode, Map<string, FunctionLike[]>>();
  const membersOf = (cls: ClassNode) => {
    const cached = membersByClass.get(cls);

    if (cached) return cached;

    const members = classMembers(cls);
    membersByClass.set(cls, members);

    return members;
  };

  const calleeTarget = (call: TSESTree.CallExpression, self: ThisContext | null): FunctionLike | undefined => {
    const callee = unwrapExpression(call.callee);

    if (callee?.type === "Identifier") {
      const resolved = references.get(callee)?.resolved;
      return resolved ? declaredFunction(resolved) : undefined;
    }

    if (self && callee?.type === "MemberExpression" && !callee.computed && callee.object.type === "ThisExpression") {
      const name = memberName(callee.property);
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
          .flatMap((node) => (node.type === "CallExpression" ? [node] : []))
          .flatMap((call) => {
            const target = calleeTarget(call, self);
            const to = target && context.functionIds.get(target);

            return to === undefined ? [] : [{ from, to, location: locationOf(call, context.file) }];
          });
  });

  const grouped = sites.reduce((map, site) => {
    const key = `${site.from}\u0000${site.to}`;
    const existing = map.get(key);

    return map.set(key, {
      kind: "calls",
      from: site.from,
      to: site.to,
      occurrences: [...(existing?.occurrences ?? []), site.location],
    });
  }, new Map<string, CallEdge>());

  return [...grouped.values()];
};
