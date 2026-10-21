export const code = (text: string) => {
  const fence = text.includes("`") ? "``" : "`";
  const padding = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${padding}${text}${padding}${fence}`;
};

const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

export const table = (header: readonly string[], rows: readonly (readonly (string | number)[])[]) =>
  rows.length === 0
    ? "none"
    : [
        `| ${header.map(cell).join(" | ")} |`,
        `| ${header.map(() => "---").join(" | ")} |`,
        ...rows.map((row) => `| ${row.map((value) => cell(String(value))).join(" | ")} |`),
      ].join("\n");

export const factLines = (pairs: readonly (readonly [string, string | number | null])[]) =>
  pairs.map(([label, value]) => `- ${label}: ${value ?? "none"}`).join("\n");

export const bullets = (items: readonly string[]) =>
  items.length === 0 ? "none" : items.map((item) => `- ${item}`).join("\n");

export const section = (title: string, body: string) => `## ${title}\n\n${body}`;

export const page = (l0: string, title: string, ...sections: readonly string[]) =>
  `${[l0, `# ${title}`, ...sections].join("\n\n")}\n`;

export const orNone = (value: string | number | null) => (value === null ? "none" : String(value));

export const plural = (count: number, word: string, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
