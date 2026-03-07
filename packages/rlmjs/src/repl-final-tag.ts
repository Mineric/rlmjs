export type ParsedFinalTag =
  | {
      kind: "final";
      answer: string;
    }
  | {
      kind: "final_var";
      name: string;
    };

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function parseQuotedStringLiteral(input: string): string | undefined {
  const trimmed = input.trim();
  if (trimmed.length < 2) {
    return undefined;
  }

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return undefined;
    }
  }

  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed
      .slice(1, -1)
      .replace(/\\\\/g, "\\")
      .replace(/\\'/g, "'");
  }

  return undefined;
}

function parseFinalValue(argumentSource: string): string | undefined {
  const quoted = parseQuotedStringLiteral(argumentSource);
  if (quoted !== undefined) {
    return quoted;
  }

  try {
    return formatValue(JSON.parse(argumentSource));
  } catch {
    return undefined;
  }
}

export function parseFinalTagLine(line: string): ParsedFinalTag | undefined {
  const trimmed = line.trim();
  if (!trimmed) {
    return undefined;
  }

  const finalVarMatch = trimmed.match(/^FINAL_VAR\s*\(\s*([\s\S]*?)\s*\)\s*;?$/);
  if (finalVarMatch) {
    const name = parseQuotedStringLiteral(finalVarMatch[1] ?? "");
    if (name !== undefined) {
      return {
        kind: "final_var",
        name
      };
    }
  }

  const finalMatch = trimmed.match(/^FINAL\s*\(\s*([\s\S]*?)\s*\)\s*;?$/);
  if (finalMatch) {
    const answer = parseFinalValue(finalMatch[1] ?? "");
    if (answer !== undefined) {
      return {
        kind: "final",
        answer
      };
    }
  }

  return undefined;
}

export function parseFinalTag(content: string): ParsedFinalTag | undefined {
  const stripped = content.replace(/```(?:js|javascript)?\s*[\s\S]*?```/gi, " ");
  const lines = stripped
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const parsed = parseFinalTagLine(lines[index] ?? "");
    if (parsed) {
      return parsed;
    }
  }

  return parseFinalTagLine(stripped);
}
