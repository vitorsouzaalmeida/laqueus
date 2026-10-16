export type Child = Node | string | number | null | undefined | false;
type Props = Record<string, string | boolean | ((event: Event) => void) | undefined>;

export const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export const h = (tag: string, props: Props = {}, ...children: Child[]): HTMLElement => {
  const element = document.createElement(tag);
  Object.entries(props).forEach(([key, value]) => {
    if (typeof value === "function") element.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "class" && typeof value === "string") element.className = value;
    else if (value === true) element.setAttribute(key, "");
    else if (typeof value === "string") element.setAttribute(key, value);
  });
  children
    .filter((child): child is Node | string | number => child !== null && child !== undefined && child !== false)
    .forEach((child) => element.append(typeof child === "number" ? String(child) : child));
  return element;
};

export const groupBy = <T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> =>
  items.reduce((map, item) => {
    const group = map.get(key(item));
    if (group) group.push(item);
    else map.set(key(item), [item]);
    return map;
  }, new Map<string, T[]>());

export const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);
export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
export const formatCC = (value: number | null) => (value === null ? "N/A" : String(value));
