/** Tall med norsk skrivemåte. */

/** Areal (mm²) som «24,5 m²» (høyst én desimal, som etikettene i planen). */
export const areaText = (mm2: number): string => `${(mm2 / 1e6).toLocaleString('nb-NO', { maximumFractionDigits: 1 })} m²`;

/** Kort navn til små flater: lange navn kuttes før en forklaring i parentes («Hage (foran …)» → «Hage»). */
export const shortName = (name: string, max = 22): string => (name.length > max && name.includes(' (') ? name.slice(0, name.indexOf(' (')) : name);
