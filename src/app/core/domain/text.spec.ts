import { miniMarkdown, normalisiereText, parseZahl } from './text';

describe('normalisiereText', () => {
  it('macht alles klein und entfernt Leer- und Sonderzeichen', () => {
    expect(normalisiereText('  Hallo Welt! ')).toBe('hallowelt');
  });

  it('schreibt Umlaute als ae/oe/ue und ß als ss', () => {
    expect(normalisiereText('Übertragungsgerät')).toBe('uebertragungsgeraet');
    expect(normalisiereText('Böse')).toBe('boese');
    expect(normalisiereText('Grösse')).toBe(normalisiereText('Größe'));
  });

  it('behandelt zerlegte Umlaute (NFD) wie zusammengesetzte', () => {
    expect(normalisiereText('Müller')).toBe(normalisiereText('Müller'));
  });

  it('entfernt andere Akzente', () => {
    expect(normalisiereText('Café')).toBe('cafe');
    expect(normalisiereText('Élève')).toBe('eleve');
  });

  it('macht USB-C-Varianten gleich', () => {
    const ziel = normalisiereText('USB-C');
    expect(ziel).toBe('usbc');
    for (const v of ['usb c', 'USBC', 'Usb-c', 'usb_c', ' USB – C ']) {
      expect(normalisiereText(v)).toBe(ziel);
    }
  });

  it('behält Ziffern', () => {
    expect(normalisiereText('IPv6 / 128 Bit')).toBe('ipv6128bit');
  });

  it('liefert für reine Sonderzeichen einen leeren Text', () => {
    expect(normalisiereText(' - ')).toBe('');
  });
});

describe('parseZahl', () => {
  it.each([
    ['42', 42],
    ['3,125', 3.125],
    ['3.125', 3.125],
    ["1'000'000", 1_000_000],
    ['1’000’000', 1_000_000],
    ['1 000 000', 1_000_000],
    ['1 000', 1000],
    ['1 000', 1000],
    ['375 MB', 375],
    ['375MB', 375],
    ['  12  ', 12],
    ['2^10', 1024],
    ['2 ^ 10', 1024],
    ['2**8', 256],
    ['2^-1', 0.5],
    ['-5', -5],
    ['-3,5', -3.5],
    ["-1'500", -1500],
    ['0', 0],
    ["1'000,5 GB", 1000.5],
    ['1.000.000', 1_000_000],
    ['1,000,000', 1_000_000],
    ['1.000.000 MB', 1_000_000],
    ['400.000', 400],
    ['-2.500.000', -2_500_000],
    ['1.000,5', 1000.5],
    ['1,000.5', 1000.5],
    ['1,234,567.25', 1_234_567.25],
    ['375.', 375],
  ])('liest «%s» als %s', (eingabe, erwartet) => {
    expect(parseZahl(eingabe)).toBe(erwartet);
  });

  it.each(['', '   ', 'abc', 'MB 375', '-', ',5', '1.2.3', '1,00,000', '12.000.00', '1.000,000.5'])('gibt null für «%s»', (eingabe) => {
    expect(parseZahl(eingabe)).toBeNull();
  });
});

describe('miniMarkdown', () => {
  it('liefert für leeren Text nichts', () => {
    expect(miniMarkdown('')).toBe('');
    expect(miniMarkdown('\n\n  \n')).toBe('');
  });

  it('trennt Absätze an Leerzeilen und bricht Zeilen innerhalb um', () => {
    expect(miniMarkdown('Erster\nzweite Zeile\n\nZweiter')).toBe('<p>Erster<br>zweite Zeile</p><p>Zweiter</p>');
  });

  it('versteht Windows-Zeilenenden', () => {
    expect(miniMarkdown('A\r\n\r\nB')).toBe('<p>A</p><p>B</p>');
  });

  it('macht aus # bis #### einen Zwischentitel', () => {
    expect(miniMarkdown('### Speicher')).toBe('<h4>Speicher</h4>');
    expect(miniMarkdown('# Eins\nText')).toBe('<h4>Eins</h4><p>Text</p>');
  });

  it('rendert Aufzählungen mit - und •', () => {
    expect(miniMarkdown('- eins\n- zwei\n• drei')).toBe('<ul><li>eins</li><li>zwei</li><li>drei</li></ul>');
  });

  it('rendert nummerierte Listen', () => {
    expect(miniMarkdown('1. Eingabe\n2. Verarbeitung\n3. Ausgabe')).toBe(
      '<ol><li>Eingabe</li><li>Verarbeitung</li><li>Ausgabe</li></ol>',
    );
  });

  it('beendet eine Liste, wenn ein Absatz folgt', () => {
    expect(miniMarkdown('Vorher\n- a\n- b\nNachher')).toBe('<p>Vorher</p><ul><li>a</li><li>b</li></ul><p>Nachher</p>');
  });

  it('rendert Tabellen und überspringt die Trennzeile', () => {
    const html = miniMarkdown('| Einheit | Bytes |\n|---|:---:|\n| KB | 1000 |\n| KiB | 1024 |');
    expect(html).toBe(
      '<div class="tabelle" tabindex="0" role="region" aria-label="Tabelle: Einheit, Bytes">' +
        '<table><thead><tr><th>Einheit</th><th>Bytes</th></tr></thead><tbody>' +
        '<tr><td>KB</td><td>1000</td></tr><tr><td>KiB</td><td>1024</td></tr></tbody></table></div>',
    );
  });

  it('gibt eine leere Ecke oben links als td aus', () => {
    const html = miniMarkdown('| | HDD | SSD |\n|---|---|---|\n| Teile | ja | nein |');
    expect(html).toContain('<thead><tr><td></td><th>HDD</th><th>SSD</th></tr></thead>');
    expect(html).toContain('aria-label="Tabelle: HDD, SSD"');
  });

  it('rendert Tabellen ohne Trennzeile', () => {
    const html = miniMarkdown('| a | b |\n| 1 | 2 |');
    expect(html).toContain('<th>a</th><th>b</th>');
    expect(html).toContain('<tr><td>1</td><td>2</td></tr>');
  });

  it('formatiert fett, kursiv, Code und Hochstellung', () => {
    expect(miniMarkdown('**fett** und *kursiv*, `code` und 2^10')).toBe(
      '<p><strong>fett</strong> und <em>kursiv</em>, <code>code</code> und 2<sup>10</sup></p>',
    );
  });

  it('formatiert auch in Listen und Tabellenzellen', () => {
    expect(miniMarkdown('- **RAM** ist flüchtig')).toBe('<ul><li><strong>RAM</strong> ist flüchtig</li></ul>');
    expect(miniMarkdown('| *x* |\n| `y` |')).toContain('<th><em>x</em></th>');
  });

  it('macht aus einem Mal-Zeichen mit Leerschlägen kein Kursiv', () => {
    expect(miniMarkdown('3 * 4 * 5')).toBe('<p>3 * 4 * 5</p>');
  });

  it('escaped HTML, damit kein XSS durchkommt', () => {
    const html = miniMarkdown('<img src=x onerror="alert(1)"> <script>alert(2)</script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escaped HTML auch in Titeln, Listen, Tabellen und Code', () => {
    const quellen = [
      '### <img src=x onerror=alert(1)>',
      '- <img src=x onerror=alert(1)>',
      '1. <img src=x onerror=alert(1)>',
      '| <img src=x onerror=alert(1)> |',
      '`<img src=x onerror=alert(1)>`',
      "**<a href='javascript:alert(1)'>x</a>**",
    ];
    for (const q of quellen) {
      const html = miniMarkdown(q);
      expect(html).not.toMatch(/<img|<a /);
      expect(html).toContain('&lt;');
    }
  });

  it('lässt das Ergebnis im DOM ohne eingeschleuste Elemente', () => {
    const div = document.createElement('div');
    div.innerHTML = miniMarkdown('Hallo <img src=x onerror=alert(1)><b>x</b> & "Du"');
    expect(div.querySelector('img')).toBeNull();
    expect(div.querySelector('b')).toBeNull();
    expect(div.textContent).toBe('Hallo <img src=x onerror=alert(1)><b>x</b> & "Du"');
  });

  it('verliert keine Zeilen, die mit «-5» oder «1.5» beginnen', () => {
    expect(miniMarkdown('-5 Grad ist kalt')).toBe('<p>-5 Grad ist kalt</p>');
    expect(miniMarkdown('Text\n-5 bis 5\n1.5 GB')).toBe('<p>Text<br>-5 bis 5<br>1.5 GB</p>');
    expect(miniMarkdown('- a\n-5 danach')).toBe('<ul><li>a</li></ul><p>-5 danach</p>');
  });

  it('verliert keinen Text bei gemischten Blöcken', () => {
    const quelle = '### T\nAbsatz\n- L1\n1. N1\n| Z |\nEnde';
    const html = miniMarkdown(quelle);
    for (const teil of ['T', 'Absatz', 'L1', 'N1', 'Z', 'Ende']) expect(html).toContain(teil);
  });
});
