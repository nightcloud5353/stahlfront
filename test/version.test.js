'use strict';
// Schutz gegen gemischte Versionen im Browser-Cache: Jede CSS-/JS-Datei in index.html muss mit
// ?v=<Version aus package.json> eingebunden sein. Bei jeder neuen Version beides erhöhen.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('alle lokalen Skripte und Stylesheets tragen die aktuelle Version', () => {
  const refs = [...html.matchAll(/(?:src|href)="((?:js|css)\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 10, 'Skripte gefunden');
  for (const r of refs) assert.match(r, new RegExp(`\\?v=${version.replace(/\./g, '\\.')}$`), `${r} braucht ?v=${version}`);
});

test('jede eingebundene Datei existiert', () => {
  const refs = [...html.matchAll(/(?:src|href)="((?:js|css)\/[^"?]+)/g)].map((m) => m[1]);
  for (const r of refs) assert.ok(fs.existsSync(path.join(root, r)), r);
});

test('Versionsanzeige im Hauptmenü passt zu package.json', () => {
  const m = html.match(/Version (\d+\.\d+)/);
  assert.ok(m, 'Versionsanzeige gefunden');
  assert.ok(version.startsWith(m[1]), `Menü zeigt ${m[1]}, package.json ${version}`);
});
