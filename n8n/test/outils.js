'use strict';
// Outils partagés par les tests des workflows n8n.

const fs = require('node:fs');
const path = require('node:path');

const FIXTURES = path.join(__dirname, 'fixtures');
const MIGRATION = path.join(__dirname, '..', '..', 'supabase', 'migrations', '20261003000000_cockpit.sql');

function fixture(nom) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, nom), 'utf8'));
}

function texteFixture(nom) {
  return fs.readFileSync(path.join(FIXTURES, nom), 'utf8');
}

const CLIENTS = fixture('clients.json');

// Le client que n8n lirait chez Stripe pour cet événement
function clientPour(evenement) {
  if (evenement.type === 'charge.dispute.created') return fixture('charge-avec-client.dispute.json');
  return CLIENTS[evenement.data.object.customer] || null;
}

// Colonnes de chaque table, lues dans la migration (source de vérité du contrat)
function colonnesMigration() {
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  const tables = {};
  const re = /create table if not exists public\.(\w+) \(([\s\S]*?)\n\);/g;
  let m;
  while ((m = re.exec(sql))) {
    const colonnes = {};
    for (const ligne of m[2].split('\n')) {
      const c = ligne.trim().match(/^([a-z_]+)\s+(.*)$/);
      if (!c || ['primary', 'unique', 'constraint', 'check'].indexOf(c[1]) >= 0) continue;
      colonnes[c[1]] = { genere: /generated always/.test(c[2]) };
    }
    tables[m[1]] = colonnes;
  }
  return tables;
}

// Vérifie que chaque clé est une vraie colonne écrivable de la table
function verifierColonnes(assert, tables, table, lignes) {
  const colonnes = tables[table];
  assert.ok(colonnes, 'table inconnue dans la migration : ' + table);
  for (const l of lignes) {
    for (const cle of Object.keys(l)) {
      assert.ok(colonnes[cle], table + '.' + cle + ' n\'existe pas dans la migration');
      assert.ok(!colonnes[cle].genere, table + '.' + cle + ' est calculée par la base');
    }
  }
}

module.exports = { fixture, texteFixture, clientPour, colonnesMigration, verifierColonnes, CLIENTS, FIXTURES, MIGRATION };
