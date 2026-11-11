export const oneLine = (text: string) => text.replace(/\r\n|\r|\n/g, "\\n");

export const code = (raw: string) => {
  const text = oneLine(raw);
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((run) => run[0].length));
  const fence = "`".repeat(longest + 1);
  const padding = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${padding}${text}${padding}${fence}`;
};

export const escapeText = (text: string) => oneLine(text).replace(/[\\`*_[\]<>]/g, "\\$&");

export const factLines = (pairs: readonly (readonly [string, string | number | null])[]) =>
  pairs.map(([label, value]) => `- ${label}: ${value ?? "none"}`).join("\n");

export const bullets = (items: readonly string[]) =>
  items.length === 0 ? "none" : items.map((item) => `- ${item}`).join("\n");

export const section = (title: string, body: string) => `## ${title}\n\n${body}`;

export const subsection = (title: string, body: string) => `### ${title}\n\n${body}`;

export const nested = (items: readonly string[]) => items.map((item) => `  - ${item}`).join("\n");

export const percent = (part: number, whole: number) =>
  whole === 0 ? "none" : `${((part / whole) * 100).toFixed(1)}%`;

export const ratioText = (value: number | null) => (value === null ? "none" : value.toFixed(2));

export const page = (l0: string, title: string, ...sections: readonly string[]) =>
  `${[oneLine(l0), `# ${escapeText(title)}`, ...sections].join("\n\n")}\n`;

export const orNone = (value: string | number | null) => (value === null ? "none" : String(value));

export const plural = (count: number, word: string, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
