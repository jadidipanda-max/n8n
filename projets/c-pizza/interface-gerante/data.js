// Données d'exemple : tous les chiffres sont fictifs.

export const SITES = [
  {
    id: 1, name: 'Point de vente 1', short: 'PV 1', cx: 310, cy: 290,
    cmd: 38, cuisine: 4, attente: 14, late: 0, panier: 8700, prep: 13, livr: 21, annul: 1,
    livreurs: '2 en course, 1 libre',
    top: [['Reine grande', 14], ['Margherita', 9], ['Calzone', 6]],
  },
  {
    id: 2, name: 'Point de vente 2', short: 'PV 2', cx: 580, cy: 240,
    cmd: 29, cuisine: 6, attente: 26, late: 2, panier: 8300, prep: 17, livr: 24, annul: 2,
    livreurs: '1 en course, 1 sur le retour',
    top: [['Reine grande', 10], ['4 fromages', 7], ['Végétarienne', 5]],
  },
  {
    id: 3, name: 'Point de vente 3', short: 'PV 3', cx: 490, cy: 390,
    cmd: 19, cuisine: 2, attente: 11, late: 0, panier: 9000, prep: 12, livr: 20, annul: 0,
    livreurs: '1 en course, aucun libre',
    top: [['Margherita', 7], ['Reine grande', 6], ['Calzone', 3]],
  },
];

export const HOURS = ['11h', '12h', '13h', '14h', '15h', '16h', '17h', '18h', '19h', '20h', '21h', '22h', '23h'];

// Commandes par heure et par point de vente, de 11h à 23h.
export const HOURLY = {
  1: [2, 4, 6, 3, 1, 2, 6, 12, 2, 0, 0, 0, 0],
  2: [1, 3, 4, 2, 1, 1, 5, 11, 1, 0, 0, 0, 0],
  3: [1, 2, 3, 1, 0, 1, 3, 7, 1, 0, 0, 0, 0],
};

// Un vendredi habituel, tous points de vente confondus.
export const TYPICAL = [5, 10, 12, 7, 3, 5, 12, 26, 32, 24, 16, 9, 4];

// Niveau de commandes de chaque quartier (0 à 3), case par case sur la carte.
export const LEVELS = [1, 2, 1, 0, 2, 3, 2, 1, 2, 2, 3, 1, 0, 1, 1, 0];

export const QUARTIERS = [
  { tile: 5, name: '[Quartier A]', count: 21 },
  { tile: 10, name: '[Quartier B]', count: 17 },
  { tile: 8, name: '[Quartier C]', count: 12 },
];

export const DRIVERS = [
  { name: 'Paul', site: 1, x: 370, y: 250 },
  { name: 'Samuel', site: 1, x: 220, y: 330 },
  { name: 'Eric', site: 2, x: 650, y: 300 },
  { name: 'Junior', site: 3, x: 430, y: 450 },
];

// Commandes à la même heure le vendredi précédent.
export const LAST_FRIDAY = 77;
