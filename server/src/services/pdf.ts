import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

function wrap(line: string, width: number) {
  if (line.length <= width) return [line];
  const words = line.split(" ");
  const rows: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > width && current) {
      rows.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) rows.push(current);
  return rows.length ? rows : [""];
}

export async function textToPdf(text: string) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const lines = text.split(/\n/).flatMap((line) => wrap(line, 92));
  let page = doc.addPage([595, 842]);
  let y = 800;
  for (const line of lines) {
    if (y < 48) {
      page = doc.addPage([595, 842]);
      y = 800;
    }
    const printable = line.replace(/[^\x20-\x7E]/g, " ");
    page.drawText(printable, { x: 48, y, size: 10, font, color: rgb(0.12, 0.1, 0.08) });
    y -= 14;
  }
  return Buffer.from(await doc.save());
}
