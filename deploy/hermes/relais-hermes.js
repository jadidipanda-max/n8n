'use strict';
// Relais TCP vers l'API Hermès, sans dépendance (Node 22).
// Hermès n'écoute que sur 127.0.0.1:8642 de l'hôte : les conteneurs ne peuvent pas le joindre.
// Ce relais (lancé par docker compose en réseau « host ») écoute sur l'adresse du pont Docker
// (host.docker.internal = host-gateway, 172.17.0.1 par défaut) et recopie chaque connexion
// vers 127.0.0.1:8642. Il refuse d'écouter sur une adresse publique ou sur toutes les adresses.

const net = require('node:net');

// Adresses d'écoute permises : réseaux privés et boucle locale (jamais 0.0.0.0 ni une IP publique).
function adresseAutorisee(ip) {
  if (net.isIP(ip) !== 4) return false;
  const [a, b] = ip.split('.').map(Number);
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true;
  return false;
}

function lirePort(valeur, defaut) {
  const n = Number.parseInt(valeur, 10);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : defaut;
}

function lireConfig(env = process.env) {
  return {
    ecouteIp: (env.RELAIS_IP || '172.17.0.1').trim(),
    ecoutePort: lirePort(env.RELAIS_PORT, 8642),
    cibleIp: (env.CIBLE_IP || '127.0.0.1').trim(),
    ciblePort: lirePort(env.CIBLE_PORT, 8642),
  };
}

function journal(texte) {
  process.stdout.write(`${new Date().toISOString()} ${texte}\n`);
}

// Démarre le relais. Renvoie le serveur (utile pour les tests).
function demarrerRelais(config, rappelPret) {
  if (!adresseAutorisee(config.ecouteIp)) {
    throw new Error(`Adresse d'écoute refusée : ${config.ecouteIp} (seulement une adresse privée).`);
  }
  if (config.ecouteIp === config.cibleIp && config.ecoutePort === config.ciblePort) {
    throw new Error("L'adresse d'écoute et la cible sont identiques.");
  }
  const serveur = net.createServer((client) => {
    const cible = net.connect({ host: config.cibleIp, port: config.ciblePort });
    client.setNoDelay(true);
    cible.setNoDelay(true);
    client.pipe(cible);
    cible.pipe(client);
    const fermer = () => {
      client.destroy();
      cible.destroy();
    };
    client.on('error', fermer);
    cible.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') journal('Hermès ne répond pas sur la cible (service arrêté ?)');
      fermer();
    });
    client.on('close', fermer);
    cible.on('close', fermer);
  });
  serveur.listen(config.ecoutePort, config.ecouteIp, () => {
    journal(`Relais Hermès prêt : ${config.ecouteIp}:${config.ecoutePort} -> ${config.cibleIp}:${config.ciblePort}`);
    if (rappelPret) rappelPret(serveur);
  });
  return serveur;
}

module.exports = { adresseAutorisee, lireConfig, demarrerRelais };

if (require.main === module) {
  let serveur;
  try {
    serveur = demarrerRelais(lireConfig());
  } catch (err) {
    journal(err.message);
    process.exit(1);
  }
  serveur.on('error', (err) => {
    // EADDRNOTAVAIL : le pont Docker n'a pas cette adresse (voir HERMES_RELAIS_IP dans .env).
    journal(`Le relais n'a pas pu démarrer : ${err.code || err.message}`);
    process.exit(1);
  });
  const arreter = () => serveur.close(() => process.exit(0));
  process.on('SIGTERM', arreter);
  process.on('SIGINT', arreter);
}
