/**
 * Algeria's 58 wilayas, each shown under one Arabic name (the owner's choice). MDM, Shopify
 * exports and people write them in Arabic, French or English, with or without the number, so
 * every name the app stores goes through `wilayaName` first and lands on the same wilaya.
 */
export const WILAYAS: readonly { code: number; ar: string; fr: string; also?: readonly string[] }[] = [
  { code: 1, ar: "أدرار", fr: "Adrar" },
  { code: 2, ar: "الشلف", fr: "Chlef", also: ["Ech Chlef", "Ech Cheliff"] },
  { code: 3, ar: "الأغواط", fr: "Laghouat" },
  { code: 4, ar: "أم البواقي", fr: "Oum El Bouaghi", also: ["OEB"] },
  { code: 5, ar: "باتنة", fr: "Batna" },
  { code: 6, ar: "بجاية", fr: "Béjaïa", also: ["Bejaya", "Bougie"] },
  { code: 7, ar: "بسكرة", fr: "Biskra" },
  { code: 8, ar: "بشار", fr: "Béchar" },
  { code: 9, ar: "البليدة", fr: "Blida" },
  { code: 10, ar: "البويرة", fr: "Bouira" },
  { code: 11, ar: "تمنراست", fr: "Tamanrasset", also: ["Tamanghasset", "Tamenghest", "تامنغست", "تمنغست"] },
  { code: 12, ar: "تبسة", fr: "Tébessa" },
  { code: 13, ar: "تلمسان", fr: "Tlemcen" },
  { code: 14, ar: "تيارت", fr: "Tiaret" },
  { code: 15, ar: "تيزي وزو", fr: "Tizi Ouzou" },
  { code: 16, ar: "الجزائر", fr: "Alger", also: ["Algiers", "Alger Centre", "El Djazair", "الجزائر العاصمة", "العاصمة"] },
  { code: 17, ar: "الجلفة", fr: "Djelfa" },
  { code: 18, ar: "جيجل", fr: "Jijel" },
  { code: 19, ar: "سطيف", fr: "Sétif" },
  { code: 20, ar: "سعيدة", fr: "Saïda" },
  { code: 21, ar: "سكيكدة", fr: "Skikda" },
  { code: 22, ar: "سيدي بلعباس", fr: "Sidi Bel Abbès", also: ["SBA"] },
  { code: 23, ar: "عنابة", fr: "Annaba" },
  { code: 24, ar: "قالمة", fr: "Guelma" },
  { code: 25, ar: "قسنطينة", fr: "Constantine" },
  { code: 26, ar: "المدية", fr: "Médéa" },
  { code: 27, ar: "مستغانم", fr: "Mostaganem" },
  { code: 28, ar: "المسيلة", fr: "M'Sila" },
  { code: 29, ar: "معسكر", fr: "Mascara" },
  { code: 30, ar: "ورقلة", fr: "Ouargla" },
  { code: 31, ar: "وهران", fr: "Oran" },
  { code: 32, ar: "البيض", fr: "El Bayadh", also: ["El Bayad"] },
  { code: 33, ar: "إليزي", fr: "Illizi" },
  { code: 34, ar: "برج بوعريريج", fr: "Bordj Bou Arréridj", also: ["BBA", "B.B.Arreridj"] },
  { code: 35, ar: "بومرداس", fr: "Boumerdès" },
  { code: 36, ar: "الطارف", fr: "El Tarf", also: ["El Taref"] },
  { code: 37, ar: "تندوف", fr: "Tindouf" },
  { code: 38, ar: "تيسمسيلت", fr: "Tissemsilt" },
  { code: 39, ar: "الوادي", fr: "El Oued", also: ["Oued Souf", "وادي سوف"] },
  { code: 40, ar: "خنشلة", fr: "Khenchela" },
  { code: 41, ar: "سوق أهراس", fr: "Souk Ahras" },
  { code: 42, ar: "تيبازة", fr: "Tipaza", also: ["Tipasa", "تيپازة"] },
  { code: 43, ar: "ميلة", fr: "Mila" },
  { code: 44, ar: "عين الدفلى", fr: "Aïn Defla", also: ["عين الدفلة"] },
  { code: 45, ar: "النعامة", fr: "Naâma" },
  { code: 46, ar: "عين تموشنت", fr: "Aïn Témouchent" },
  { code: 47, ar: "غرداية", fr: "Ghardaïa" },
  { code: 48, ar: "غليزان", fr: "Relizane", also: ["Ghilizane"] },
  { code: 49, ar: "تيميمون", fr: "Timimoun" },
  { code: 50, ar: "برج باجي مختار", fr: "Bordj Badji Mokhtar", also: ["BBM"] },
  { code: 51, ar: "أولاد جلال", fr: "Ouled Djellal", also: ["Oulad Djellal"] },
  { code: 52, ar: "بني عباس", fr: "Béni Abbès" },
  { code: 53, ar: "عين صالح", fr: "In Salah", also: ["Ain Salah", "إن صالح"] },
  { code: 54, ar: "عين قزام", fr: "In Guezzam", also: ["Ain Guezzam", "إن قزام", "عين ڨزام"] },
  { code: 55, ar: "تقرت", fr: "Touggourt", also: ["Tuggurt", "توقرت"] },
  { code: 56, ar: "جانت", fr: "Djanet" },
  { code: 57, ar: "المغير", fr: "El M'Ghair", also: ["El Meghaier", "El Mghaier", "Meghaier"] },
  { code: 58, ar: "المنيعة", fr: "El Meniaa", also: ["El Menia", "El Menea", "El Ménéa"] },
];

const BY_CODE = new Map(WILAYAS.map((w) => [w.code, w]));

/**
 * One spelling per name: no accents or Arabic diacritics (which also turns أ إ آ into ا), one
 * form of ة/ى/ڨ/پ, no "wilaya"/"ولاية" in front, no spaces or punctuation, lower case.
 */
function key(s: string) {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ـ/g, "")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ڨ/g, "ق")
    .replace(/پ/g, "ب")
    .toLowerCase()
    .replace(/^\s*(wilaya|ولايه)\s*(de|d'|d’|of)?\s*/u, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

const BY_NAME = new Map<string, number>();
for (const w of WILAYAS) {
  for (const name of [w.ar, w.fr, ...(w.also ?? [])]) {
    const k = key(name);
    BY_NAME.set(k, w.code);
    // "El Oued" and "Oued", "الوادي" and "وادي": the article is often dropped.
    const bare = k.replace(/^(el|al|ال)(?=\p{L}{3})/u, "");
    if (!BY_NAME.has(bare)) BY_NAME.set(bare, w.code);
  }
}

const codeOf = (n: string) => {
  const c = Number(n);
  return BY_CODE.has(c) ? c : null;
};

/** The wilaya's number (1 to 58), from a name in any language, a code like "16" or "DZ-16", or both ("16 - Alger"). */
export function wilayaCode(raw: string | null | undefined): number | null {
  const s = raw?.trim();
  if (!s) return null;
  const onlyCode = /^(?:dz\s*-?\s*)?0*(\d{1,2})$/i.exec(s);
  if (onlyCode) return codeOf(onlyCode[1]);
  const named = BY_NAME.get(key(s)) ?? BY_NAME.get(key(s).replace(/^(el|al|ال)(?=\p{L}{3})/u, ""));
  if (named) return named;
  // "16 - Alger", "16- الجزائر", "Alger (16)": the name wins, the number is the fallback.
  const lead = /^0*(\d{1,2})\s*[-–:.)]?\s*(\D.*)$/.exec(s);
  const trail = /^(\D.*?)\s*[-–(]?\s*0*(\d{1,2})\)?$/.exec(s);
  const parts = lead ? { n: lead[1], name: lead[2] } : trail ? { n: trail[2], name: trail[1] } : null;
  if (parts) return BY_NAME.get(key(parts.name)) ?? codeOf(parts.n);
  return null;
}

/** The name the app stores and shows: the wilaya's Arabic name, or what was given (trimmed) when it isn't a wilaya. */
export function wilayaName(raw: string | null | undefined): string | null {
  const s = raw?.trim();
  if (!s) return null;
  const code = wilayaCode(s);
  return code ? BY_CODE.get(code)!.ar : s;
}

/** MDM sends a name and a code: the name first, the code when the name isn't one we know. */
export function mdmWilaya(name: string | null, code: string | null): string | null {
  const byName = wilayaCode(name);
  const byCode = byName ?? wilayaCode(code);
  return byCode ? BY_CODE.get(byCode)!.ar : (name?.trim() || code?.trim() || null);
}

/** Two wilaya names mean the same wilaya (or the same text, when neither is a wilaya). */
export function sameWilaya(a: string | null | undefined, b: string | null | undefined) {
  const ca = wilayaCode(a);
  const cb = wilayaCode(b);
  if (ca || cb) return ca === cb;
  return !!a && !!b && key(a) === key(b);
}

/** Wilaya names in number order (Adrar first), other names after them; each name once. */
export function sortWilayas(names: Iterable<string | null | undefined>): string[] {
  const list = [...new Set([...names].filter((n): n is string => !!n?.trim()))];
  return list.sort((a, b) => (wilayaCode(a) ?? 99) - (wilayaCode(b) ?? 99) || a.localeCompare(b));
}

/** "16 الجزائر": the name with its number in front, for pickers. */
export function wilayaLabel(name: string) {
  const code = wilayaCode(name);
  return code ? `${String(code).padStart(2, "0")} ${name}` : name;
}
