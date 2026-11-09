#!/usr/bin/env node
const fs = require('node:fs');
const { hashPassword } = require('../src/security');

function usage() {
  console.error('Usage : printf \'%s\' "mon-mot-de-passe" | npm run hash-password');
  console.error('        npm run hash-password -- "mon-mot-de-passe"');
  process.exit(1);
}

let password = process.argv[2];

if (!password && process.stdin.isTTY) usage();

if (!password) {
  try {
    password = fs.readFileSync(0, 'utf8').trim();
  } catch {
    usage();
  }
}

if (!password || password.length < 12) {
  console.error('Le mot de passe doit contenir au moins 12 caractères.');
  process.exit(1);
}

const hash = hashPassword(password);

console.log(hash);
console.error('');
console.error('Ajoutez cette ligne à votre fichier .env (avec les apostrophes, pour que');
console.error('Docker Compose n\'interprète pas les caractères $) :');
console.error(`ADMIN_PASSWORD_HASH='${hash}'`);
