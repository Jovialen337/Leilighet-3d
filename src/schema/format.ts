/**
 * Skriver apartment.json kompakt og lesbart, slik fila er skrevet for hånd:
 * korte objekter og lister på én linje (≤ 110 tegn), ellers ett element
 * per linje med to mellomrom innrykk.
 */
const WIDTH = 110;

function flat(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(flat).join(', ')}]`;
  if (v !== null && typeof v === 'object')
    return `{${Object.entries(v)
      .filter(([, x]) => x !== undefined)
      .map(([k, x]) => `${JSON.stringify(k)}: ${flat(x)}`)
      .join(', ')}}`;
  return JSON.stringify(v) ?? 'null';
}

function fmt(v: unknown, indent: string): string {
  const one = flat(v);
  if (v === null || typeof v !== 'object' || one.length + indent.length <= WIDTH) return one;
  const inner = `${indent}  `;
  if (Array.isArray(v)) return `[\n${v.map((x) => inner + fmt(x, inner)).join(',\n')}\n${indent}]`;
  const lines = Object.entries(v)
    .filter(([, x]) => x !== undefined)
    .map(([k, x]) => `${inner}${JSON.stringify(k)}: ${fmt(x, inner)}`);
  return `{\n${lines.join(',\n')}\n${indent}}`;
}

export function formatJson(value: unknown): string {
  return `${fmt(value, '')}\n`;
}
