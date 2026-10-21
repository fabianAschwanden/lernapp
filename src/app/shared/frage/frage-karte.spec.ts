import { ohneUrteil } from './frage-karte';

describe('ohneUrteil', () => {
  it('entfernt «Richtig.»/«Falsch.» am Anfang der Erklärung', () => {
    expect(ohneUrteil('Richtig. Tastatur und Maus sind Eingabegeräte.', 'einfachwahl')).toBe(
      'Tastatur und Maus sind Eingabegeräte.',
    );
    expect(ohneUrteil('Falsch! So nicht.', 'kurzantwort')).toBe('So nicht.');
  });

  it('sagt bei Wahr-oder-falsch-Fragen, dass die Aussage gemeint ist', () => {
    expect(ohneUrteil('Falsch. Die Cloud ist Speicherplatz im Internet.', 'wahrfalsch')).toBe(
      'Die Aussage stimmt nicht. Die Cloud ist Speicherplatz im Internet.',
    );
    expect(ohneUrteil('Richtig. Ohne Software geht nichts.', 'wahrfalsch')).toBe(
      'Die Aussage stimmt. Ohne Software geht nichts.',
    );
  });

  it('lässt andere Erklärungen unverändert', () => {
    expect(ohneUrteil('Richtigerweise gilt 1 Byte = 8 Bit.', 'zahl')).toBe(
      'Richtigerweise gilt 1 Byte = 8 Bit.',
    );
    expect(ohneUrteil('Das ist richtig.', 'wahrfalsch')).toBe('Das ist richtig.');
  });
});
