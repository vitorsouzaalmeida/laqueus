import type { TSESTree } from "@typescript-eslint/types";
import { type FunctionLike, type Parents, isFunction, outerOfWrappers, read, unwrapExpression } from "./ast";
import { isSnippet, markupLabel, templateName } from "./svelte";

type Member = TSESTree.MethodDefinition | TSESTree.PropertyDefinition | TSESTree.AccessorProperty | TSESTree.Property;

const keyName = (member: Member): string => {
  const key = member.key;

  if (member.computed) return key.type === "Literal" ? `[${JSON.stringify(String(key.value))}]` : "[computed]";
  if (key.type === "Identifier") return key.name;
  if (key.type === "PrivateIdentifier") return `#${key.name}`;
  if (key.type === "Literal") return String(key.value);

  return "<key>";
};

const memberPath = (node: TSESTree.Node | null | undefined): string | undefined => {
  if (node?.type === "Identifier") return node.name;
  if (node?.type === "ThisExpression") return "this";

  if (node?.type === "MemberExpression" && !node.computed) {
    const object = memberPath(node.object);
    return object && `${object}.${node.property.name}`;
  }

  return undefined;
};

const bindingName = (holder: TSESTree.Node, parents: Parents) => {
  const parent = parents.get(holder);

  if (parent?.type === "VariableDeclarator" && parent.init === holder) return memberPath(parent.id);
  if (parent?.type === "AssignmentExpression" && parent.right === holder) return memberPath(parent.left);

  return undefined;
};

const className = (member: TSESTree.Node, parents: Parents) => {
  const body = parents.get(member);
  const cls = body && parents.get(body);
  const ownName = cls?.type === "ClassDeclaration" || cls?.type === "ClassExpression" ? memberPath(cls.id) : undefined;

  return ownName ?? (cls && bindingName(outerOfWrappers(cls, parents), parents)) ?? "<anonymous class>";
};

const accessorSuffix = (member: Member) =>
  "kind" in member && member.kind === "get" ? " [get]" : "kind" in member && member.kind === "set" ? " [set]" : "";

const calleeLabel = (callee: TSESTree.Node): string => {
  const inner = unwrapExpression(callee) ?? callee;
  const named = memberPath(inner);

  if (named) return named;

  return inner.type === "MemberExpression" && !inner.computed ? inner.property.name : "call";
};

type Owner = FunctionLike | TSESTree.Node | "template";

export const functionNamer = (parents: Parents, template: ReadonlySet<TSESTree.Node>) => {
  const names = new Map<TSESTree.Node, string>();

  const ownerOf = (node: TSESTree.Node): Owner | undefined => {
    const parent = parents.get(node);

    if (!parent) return template.has(node) ? "template" : undefined;

    return isFunction(parent) || isSnippet(parent) ? parent : ownerOf(parent);
  };

  const anonymous = (fn: FunctionLike, holder: TSESTree.Node): string => {
    const parent = parents.get(holder);
    const isArgument =
      (parent?.type === "CallExpression" || parent?.type === "NewExpression") &&
      parent.arguments.some((argument) => argument === holder);
    const markup = markupLabel(holder, parents);

    if (isArgument && parent)
      return `${parent.type === "NewExpression" ? "new " : ""}${calleeLabel(parent.callee)} callback`;
    if (markup !== undefined) return `${markup} callback`;

    return `<anonymous>@${fn.loc.start.line}`;
  };

  const ownLabel = (fn: FunctionLike): string => {
    const ownName = memberPath(fn.id);
    const holder = outerOfWrappers(fn, parents);
    const fallback = () => ownName ?? anonymous(fn, holder);

    if (fn.type === "FunctionDeclaration") return ownName ?? "default";

    const parent = parents.get(holder);

    if (!parent) return fallback();

    switch (parent.type) {
      case "MethodDefinition":
      case "PropertyDefinition":
      case "AccessorProperty":
        return `${className(parent, parents)}.${keyName(parent)}${accessorSuffix(parent)}`;
      case "Property": {
        if (parent.value !== holder) return fallback();

        const object = parents.get(parent);
        const owner = object && bindingName(outerOfWrappers(object, parents), parents);
        const key = `${keyName(parent)}${accessorSuffix(parent)}`;

        return owner ? `${owner}.${key}` : key;
      }
      case "VariableDeclarator":
      case "AssignmentExpression":
        return bindingName(holder, parents) ?? fallback();
      case "AssignmentPattern":
        return parent.right === holder ? (memberPath(parent.left) ?? fallback()) : fallback();
      case "ExportDefaultDeclaration":
        return ownName ?? "default";
      default:
        return fallback();
    }
  };

  const labelOf = (node: TSESTree.Node): string => {
    if (isFunction(node)) return ownLabel(node);

    const name = read(read(node, "id"), "name");

    return typeof name === "string" ? name : "snippet";
  };

  const prefix = (node: TSESTree.Node): string => {
    const owner = ownerOf(node);

    if (owner === undefined) return "";

    return `${owner === "template" ? templateName : nameFor(owner)} › `;
  };

  const nameFor = (node: TSESTree.Node): string => {
    const known = names.get(node);

    if (known !== undefined) return known;

    const name = `${prefix(node)}${labelOf(node)}`;
    names.set(node, name);

    return name;
  };

  const classLabel = (cls: TSESTree.ClassDeclaration | TSESTree.ClassExpression): string =>
    `${prefix(cls)}${memberPath(cls.id) ?? bindingName(outerOfWrappers(cls, parents), parents) ?? "<anonymous class>"}`;

  return { nameFor, classLabel };
};
