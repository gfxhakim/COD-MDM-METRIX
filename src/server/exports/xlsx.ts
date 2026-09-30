import { deflateRawSync } from "node:zlib";

/**
 * A small, dependency-free Excel (.xlsx) writer: one or more sheets with a red header row,
 * frozen and filterable, real numbers and dates, and column widths that fit the content.
 * Strings are written inline, so a cell can never become a formula.
 */

export type XCell = string | number | Date | null | undefined;
export type XColumn = { header: string; kind: "text" | "number" | "money" | "datetime" };
export type XSheet = {
  name: string;
  columns: XColumn[];
  rows: XCell[][];
  /** Bold the last row (a totals row). */
  totalsRow?: boolean;
};

// ---------------------------------------------------------------- zip (store + deflate, no zip64)

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(files: { name: string; data: string | Buffer }[], at = new Date()): Buffer {
  const dosTime = ((at.getHours() << 11) | (at.getMinutes() << 5) | Math.floor(at.getSeconds() / 2)) & 0xffff;
  const dosDate = (((at.getFullYear() - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate()) & 0xffff;
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const raw = typeof f.data === "string" ? Buffer.from(f.data, "utf8") : f.data;
    const packed = deflateRawSync(raw);
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, packed);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// ---------------------------------------------------------------- spreadsheet XML

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const NS_R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** XML-safe text: escaped, with the control characters XML forbids removed. */
export function xmlText(s: string): string {
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function columnLetter(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// Cell styles (index into cellXfs below).
const S = { header: 1, datetime: 2, int: 3, dec: 4, bold: 5, boldInt: 6, boldDec: 7 } as const;

const STYLES = `${HEAD}<styleSheet ${NS}>
<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFC8102E"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="3" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>
<xf numFmtId="4" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** Excel serial day number for a Date already shifted to local wall time (as UTC fields). */
export const excelSerial = (localAsUtc: Date) => localAsUtc.getTime() / 86_400_000 + 25_569;

function sheetXml(sheet: XSheet, toLocal: (d: Date) => Date): string {
  const cols = sheet.columns;
  const moneyDecimals = sheet.rows.some((r) => cols.some((c, i) => c.kind === "money" && typeof r[i] === "number" && !Number.isInteger(r[i] as number)));
  const widths = cols.map((c) => Math.max(10, Math.min(50, c.header.length + 3)));
  const out: string[] = [];
  const cell = (ref: string, v: XCell, kind: XColumn["kind"], bold: boolean): string => {
    if (v === null || v === undefined || v === "") return "";
    if (v instanceof Date) return `<c r="${ref}" s="${S.datetime}"><v>${excelSerial(toLocal(v))}</v></c>`;
    if (typeof v === "number") {
      if (!Number.isFinite(v)) return "";
      const style = kind === "money" && moneyDecimals ? (bold ? S.boldDec : S.dec) : bold ? S.boldInt : S.int;
      return `<c r="${ref}" s="${style}"><v>${v}</v></c>`;
    }
    return `<c r="${ref}" t="inlineStr"${bold ? ` s="${S.bold}"` : ""}><is><t xml:space="preserve">${xmlText(v)}</t></is></c>`;
  };
  out.push(`<row r="1">${cols.map((c, i) => `<c r="${columnLetter(i)}1" t="inlineStr" s="${S.header}"><is><t xml:space="preserve">${xmlText(c.header)}</t></is></c>`).join("")}</row>`);
  sheet.rows.forEach((row, ri) => {
    const r = ri + 2;
    const bold = !!sheet.totalsRow && ri === sheet.rows.length - 1;
    out.push(`<row r="${r}">${cols.map((c, i) => cell(`${columnLetter(i)}${r}`, row[i], c.kind, bold)).join("")}</row>`);
    cols.forEach((c, i) => {
      const v = row[i];
      const len = v instanceof Date ? 16 : typeof v === "number" ? 12 : typeof v === "string" ? v.length : 0;
      widths[i] = Math.max(widths[i], Math.min(50, len + 2));
    });
  });
  const last = `${columnLetter(cols.length - 1)}${sheet.rows.length + 1}`;
  // A totals row stays out of the filter, so sorting never moves it.
  const lastFiltered = `${columnLetter(cols.length - 1)}${filteredRows(sheet) + 1}`;
  return `${HEAD}<worksheet ${NS} ${NS_R}>
<dimension ref="A1:${last}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>
<sheetData>${out.join("")}</sheetData>
<autoFilter ref="A1:${lastFiltered}"/>
</worksheet>`;
}

const filteredRows = (s: XSheet) => Math.max(0, s.rows.length - (s.totalsRow ? 1 : 0));

/** Sheet names: at most 31 characters, none of []:*?/\ and unique. */
function sheetName(name: string, taken: Set<string>): string {
  const base = name.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Sheet";
  let n = base;
  for (let i = 2; taken.has(n.toLowerCase()); i++) n = `${base.slice(0, 28)} ${i}`;
  taken.add(n.toLowerCase());
  return n;
}

/** `toLocal` shifts an instant to the workspace's wall-clock time, so dates read as they do in the app. */
export function buildXlsx(sheets: XSheet[], toLocal: (d: Date) => Date = (d) => d): Buffer {
  const taken = new Set<string>();
  const named = sheets.map((s) => ({ ...s, name: sheetName(s.name, taken) }));
  const files: { name: string; data: string }[] = [
    {
      name: "[Content_Types].xml",
      data: `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${named.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
    },
    { name: "_rels/.rels", data: `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    {
      name: "xl/workbook.xml",
      data: `${HEAD}<workbook ${NS} ${NS_R}><bookViews><workbookView/></bookViews><sheets>${named.map((s, i) => `<sheet name="${xmlText(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets><definedNames>${named
        .map((s, i) => `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xmlText(s.name.replace(/'/g, "''"))}'!$A$1:$${columnLetter(s.columns.length - 1)}$${filteredRows(s) + 1}</definedName>`)
        .join("")}</definedNames></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${named.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: "xl/styles.xml", data: STYLES },
    ...named.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s, toLocal) })),
  ];
  return zip(files);
}
