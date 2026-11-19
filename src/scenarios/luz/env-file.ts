import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const envName = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Parse a small dotenv-compatible file without expanding variables or logging values. */
export async function readAppointmentEnvFile(file: string): Promise<Record<string, string>> {
  const absolute = resolve(file);
  let contents: string;
  try {
    contents = await readFile(absolute, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Environment file not found: ${absolute}`, { cause: error });
    }
    throw error;
  }

  const values: Record<string, string> = {};
  for (const [index, rawLine] of contents.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const assignment = line.match(/^(?:export\s+)?([^=\s]+)\s*=\s*(.*)$/);
    if (!assignment || !envName.test(assignment[1])) {
      throw new Error(`Invalid environment assignment on line ${index + 1} of ${absolute}.`);
    }

    let value = assignment[2].trim();
    if (value.startsWith("\"")) {
      const quoted = value.match(/^"((?:\\.|[^"])*)"(?:\s+#.*)?$/);
      if (!quoted) throw new Error(`Invalid quoted environment value on line ${index + 1} of ${absolute}.`);
      value = quoted[1].replace(/\\([\\"nrt])/g, (_match, escaped: string) => {
        switch (escaped) {
          case "\\": return "\\";
          case '"': return '"';
          case "n": return "\n";
          case "r": return "\r";
          case "t": return "\t";
          default: return escaped;
        }
      });
    } else if (value.startsWith("'")) {
      const quoted = value.match(/^'([^']*)'(?:\s+#.*)?$/);
      if (!quoted) throw new Error(`Invalid quoted environment value on line ${index + 1} of ${absolute}.`);
      value = quoted[1];
    } else {
      value = value.replace(/\s+#.*$/, "").trimEnd();
    }
    values[assignment[1]] = value;
  }
  return values;
}
