/** Elemente, die eine Tabellenzelle nicht aufnimmt (Zellen enthalten Absätze und Listen), und die beim Einfügen zu Absätzen werden. */
const NOT_IN_CELLS = 'h1, h2, h3, h4, h5, h6, pre, blockquote, hr, table';

/** Die Absätze, die an die Stelle eines Elements treten, das in einer Zelle nicht stehen darf. */
function paragraphsFor(doc: Document, el: Element): Node[] {
  const tag = el.tagName;
  if (tag === 'HR') return [];
  if (tag === 'BLOCKQUOTE') return [...el.childNodes]; // Zitat auspacken: Die Absätze darin bleiben
  const p = doc.createElement('p');
  if (/^H[1-6]$/.test(tag)) {
    // Überschrift → fetter Absatz
    const strong = doc.createElement('strong');
    strong.innerHTML = el.innerHTML;
    p.append(strong);
    return [p];
  }
  if (tag === 'PRE') {
    (el.textContent ?? '').split('\n').forEach((line, i) => {
      if (i) p.append(doc.createElement('br'));
      p.append(doc.createTextNode(line));
    });
    return [p];
  }
  // Verschachtelte Tabelle → ein Absatz je Zeile, die Zellen mit „ · “ getrennt
  return [...el.querySelectorAll('tr')]
    .map((tr) => {
      const line = doc.createElement('p');
      line.textContent = [...tr.children].map((c) => (c.textContent ?? '').trim()).filter(Boolean).join(' · ');
      return line;
    })
    .filter((line) => line.textContent);
}

/**
 * Macht eingefügtes HTML für die Zellen der Tabelle brauchbar. Ein `<td>` mit Überschrift, Zitat, Codeblock, Trennlinie oder
 * verschachtelter Tabelle würde sonst die Tabelle an dieser Stelle zerreißen: eine leere Tabelle, die Überschrift außerhalb, der Rest
 * in einer zweiten Tabelle. Der Text bleibt erhalten. Ohne Tabelle im HTML (oder ohne DOM) bleibt es unverändert.
 */
export function flattenCellContent(html: string): string {
  if (!/<t[dh][\s>]/i.test(html) || typeof DOMParser === 'undefined') return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let changed = false;
  for (const cell of [...doc.querySelectorAll('td, th')]) {
    // Von hinten nach vorn: Innere Elemente werden vor den äußeren ersetzt.
    for (const el of [...cell.querySelectorAll(NOT_IN_CELLS)].reverse()) {
      changed = true;
      el.replaceWith(...paragraphsFor(doc, el));
    }
  }
  return changed ? doc.body.innerHTML : html;
}
