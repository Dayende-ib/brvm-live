const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHtml, toNumber } = require('../src/scraper');

const HTML = `
<!DOCTYPE html>
<html lang="fr">
<body>
  <p>Dernière mise à jour : 08/11/2026 18:30 | source BRVM</p>
  <table>
    <thead>
      <tr>
        <th>Symbole</th>
        <th>Nom</th>
        <th>Volume</th>
        <th>Cours veille</th>
        <th>Ouverture</th>
        <th>Clôture</th>
        <th>Variation (%)</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>ABJC</td>
        <td> SERVAIR ABIDJAN </td>
        <td>3 026</td>
        <td>3 395</td>
        <td>3 400</td>
        <td>3 400</td>
        <td>+0,15%</td>
      </tr>
      <tr>
        <td>SNTS</td>
        <td>SONATEL</td>
        <td>-</td>
        <td>20 000</td>
        <td>20 100</td>
        <td>19 800</td>
        <td>-1,00%</td>
      </tr>
      <tr>
        <td>ONTBF</td>
        <td>ONTANG</td>
        <td>1 000</td>
        <td>15 000</td>
        <td>15 100</td>
        <td>15 200</td>
        <td>-</td>
      </tr>
    </tbody>
  </table>
</body>
</html>`;

test('toNumber gère les formats français et les valeurs vides', () => {
  assert.equal(toNumber('3 026'), 3026);
  assert.equal(toNumber('3\u00a0026,5'), 3026.5);
  assert.equal(toNumber('-1,25%'), -1.25);
  assert.equal(toNumber('+0,15 %'), 0.15);
  assert.equal(toNumber('-'), null);
  assert.equal(toNumber(''), null);
  assert.equal(toNumber(null), null);
});

test('parseHtml extrait le tableau des cotations', () => {
  const data = parseHtml(HTML, 'https://example.test');

  assert.equal(data.maj, '08/11/2026 18:30');
  assert.equal(data.actions.length, 3);

  const abjc = data.actions.find((action) => action.symbole === 'ABJC');
  assert.equal(abjc.nom, 'SERVAIR ABIDJAN');
  assert.equal(abjc.volume, 3026);
  assert.equal(abjc.cours_veille, 3395);
  assert.equal(abjc.variation_pct, 0.15);

  const snts = data.actions.find((action) => action.symbole === 'SNTS');
  assert.equal(snts.volume, null);
  assert.equal(snts.variation_pct, -1);
});

test('parseHtml calcule la variation quand elle est absente', () => {
  const data = parseHtml(HTML, 'https://example.test');
  const ontbf = data.actions.find((action) => action.symbole === 'ONTBF');
  assert.equal(ontbf.variation_pct, 1.33);
});

test('parseHtml échoue proprement sans tableau exploitable', () => {
  assert.throws(
    () => parseHtml('<html><body><p>Aucun tableau</p></body></html>', 'https://example.test'),
    /Tableau des cours introuvable/
  );
});
