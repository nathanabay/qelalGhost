// Minimal, dependency-free PDF of a tender (title + facts + description). Uses
// the standard Helvetica fonts (no embedding), wraps text, and paginates. Note:
// standard PDF fonts are Latin-1 only, so non-Latin (e.g. Amharic) glyphs are
// dropped — the inline description in the app renders those; this is a
// printable/shareable copy for the Latin content.

type Line = { t: string; size: number; bold?: boolean };

export function buildTenderPdf(title: string, meta: string[], description: string, url: string): Buffer {
  const W = 612, H = 792, ML = 54, top = H - 54, bottom = 54;
  const san = (s: string) => String(s || "").replace(/[^\x20-\x7E\xA0-\xFF]/g, ""); // keep Latin-1 printable
  const escTxt = (s: string) => san(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const wrap = (text: string, max: number): string[] => {
    const out: string[] = [];
    for (const para of String(text || "").split(/\n+/)) {
      const words = san(para).split(/\s+/).filter(Boolean);
      if (!words.length) { out.push(""); continue; }
      let line = "";
      for (const w of words) {
        if (line && (line.length + 1 + w.length) > max) { out.push(line); line = w; }
        else line = line ? line + " " + w : w;
      }
      if (line) out.push(line);
    }
    return out;
  };

  const lines: Line[] = [];
  for (const t of wrap(title, 56)) lines.push({ t, size: 16, bold: true });
  lines.push({ t: "", size: 8 });
  for (const m of meta) for (const t of wrap(m, 88)) lines.push({ t, size: 10.5 });
  lines.push({ t: "", size: 6 });
  for (const t of wrap(description, 94)) lines.push({ t, size: 10.5 });
  lines.push({ t: "", size: 8 });
  for (const t of wrap("Source: " + url, 94)) lines.push({ t, size: 9 });

  const pages: string[] = [];
  let buf = "", cy = top;
  const startPage = () => { buf = `BT 1 0 0 1 ${ML} ${top} Tm\n`; cy = top; };
  startPage();
  for (const ln of lines) {
    const lh = ln.size + 5;
    if (cy - lh < bottom) { buf += "ET"; pages.push(buf); startPage(); }
    buf += `/${ln.bold ? "F2" : "F1"} ${ln.size} Tf\n`;
    if (ln.t) buf += `(${escTxt(ln.t)}) Tj\n`;
    buf += `0 -${lh} Td\n`;
    cy -= lh;
  }
  buf += "ET"; pages.push(buf);

  const objs: string[] = [];
  const firstContent = 5, firstPage = 5 + pages.length;
  objs[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objs[2] = `<< /Type /Pages /Kids [${pages.map((_, i) => `${firstPage + i} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objs[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;
  objs[4] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>`;
  for (let i = 0; i < pages.length; i++) {
    objs[firstContent + i] = `<< /Length ${Buffer.byteLength(pages[i], "binary")} >>\nstream\n${pages[i]}\nendstream`;
    objs[firstPage + i] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${firstContent + i} 0 R >>`;
  }
  const total = firstPage + pages.length;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let n = 1; n < total; n++) { offsets[n] = Buffer.byteLength(out, "binary"); out += `${n} 0 obj\n${objs[n]}\nendobj\n`; }
  const xrefPos = Buffer.byteLength(out, "binary");
  out += `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let n = 1; n < total; n++) out += String(offsets[n]).padStart(10, "0") + " 00000 n \n";
  out += `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return Buffer.from(out, "binary");
}
