import { inflateRawSync } from "zlib";

/**
 * Minimal .xlsx reader: enough to pull cell values out of each worksheet.
 * An .xlsx is a zip of XML parts; this reads the zip directory, inflates the parts it needs,
 * and resolves shared strings. Formulas come back as their cached values.
 */

export type Sheet = { name: string; rows: Record<string, string>[] };

function unzip(buffer: Buffer) {
  // The end-of-central-directory record sits in the last 64 KB.
  let end = -1;
  for (let at = buffer.length - 22; at >= Math.max(0, buffer.length - 65558); at -= 1) {
    if (buffer.readUInt32LE(at) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new Error("This file is not an Excel .xlsx workbook.");
  const count = buffer.readUInt16LE(end + 10);
  let pointer = buffer.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(pointer) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(pointer + 10);
    const compressed = buffer.readUInt32LE(pointer + 20);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const extraLength = buffer.readUInt16LE(pointer + 30);
    const commentLength = buffer.readUInt16LE(pointer + 32);
    const local = buffer.readUInt32LE(pointer + 42);
    const name = buffer.toString("utf8", pointer + 46, pointer + 46 + nameLength);
    const dataStart = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const raw = buffer.subarray(dataStart, dataStart + compressed);
    if (method === 0) files.set(name, raw);
    else if (method === 8) files.set(name, inflateRawSync(raw));
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decode(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, code: string) => {
    if (code[0] === "#") return String.fromCodePoint(code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : Number(code.slice(1)));
    return ENTITIES[code] ?? whole;
  });
}

function textOf(xml: string) {
  return decode([...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((match) => match[1]).join(""));
}

export function readWorkbook(buffer: Buffer): Sheet[] {
  const files = unzip(buffer);
  const part = (name: string) => files.get(name)?.toString("utf8") ?? "";
  const shared = [...part("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => textOf(match[1]));
  const targets = new Map([...part("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)].map((match) => [/Id="([^"]+)"/.exec(match[0])?.[1] ?? "", /Target="([^"]+)"/.exec(match[0])?.[1] ?? ""]));
  const sheets: Sheet[] = [];
  for (const match of part("xl/workbook.xml").matchAll(/<sheet\b[^>]*>/g)) {
    const name = decode(/name="([^"]*)"/.exec(match[0])?.[1] ?? "");
    const target = (targets.get(/r:id="([^"]+)"/.exec(match[0])?.[1] ?? "") ?? "").replace(/^\//, "");
    const xml = part(target.startsWith("xl/") ? target : `xl/${target}`);
    const rows: Record<string, string>[] = [];
    for (const row of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const cells: Record<string, string> = {};
      for (const cell of (row[1] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = /r="([A-Z]+)\d+"/.exec(cell[1])?.[1];
        if (!ref) continue;
        const type = /t="([^"]+)"/.exec(cell[1])?.[1];
        const body = cell[2] ?? "";
        const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        const text = type === "s" && value != null ? shared[Number(value)] ?? "" : type === "inlineStr" ? textOf(body) : value != null ? decode(value) : "";
        if (text !== "") cells[ref] = text;
      }
      rows.push(cells);
    }
    sheets.push({ name, rows });
  }
  return sheets;
}
