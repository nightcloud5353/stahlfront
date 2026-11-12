// STAHLFRONT – gemeinsame Definitionen (Gastgeber-Simulation + Darstellung)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SHARED = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // mode: 'fire'   = Winkel + Kraft einstellen, dann FEUER
  //       'aim'    = nur Winkel (Kraft egal), sofort
  //       'now'    = sofort, ohne Zielen
  //       'target' = Ziel auf der Karte anklicken
  // from = ab welchem eigenen Zug verfügbar (Balancing: keine Superwaffen im ersten Zug)
  const WEAPONS = [
    { id: 'shell',   name: 'HE-Granate',       short: 'HE-GRANATE', ammo: -1, from: 1, mode: 'fire',   info: 'Standardschuss. Der Wind lenkt sie ab, sie explodiert beim Aufprall.' },
    { id: 'bouncer', name: 'Abprallgranate',   short: 'ABPRALLER',  ammo: -1, from: 1, mode: 'fire',   info: 'Springt über den Boden und explodiert nach 3 Sekunden. Kaum Wind.' },
    { id: 'cluster', name: 'Streumunition',    short: 'STREU',      ammo: 2,  from: 2, mode: 'fire',   info: 'Zerplatzt beim Aufprall in 5 kleine Sprengsätze.' },
    { id: 'mg',      name: 'MG-Salve',         short: 'MG',         ammo: -1, from: 1, mode: 'aim',    info: '5 Kugeln geradeaus. Kein Wind, keine Schwerkraft – nur auf Sicht.' },
    { id: 'drill',   name: 'Bunkerbrecher',    short: 'BUNKER',     ammo: 2,  from: 2, mode: 'fire',   info: 'Bohrt sich in den Boden und explodiert dort. Durchschlägt auch Beton besser.' },
    { id: 'mine',    name: 'Mine',             short: 'MINE',       ammo: 2,  from: 1, mode: 'now',    info: 'Wird hinter dir abgelegt. Scharf nach 1 s, explodiert bei Kontakt.' },
    { id: 'strike',  name: 'Artillerieschlag', short: 'ARTILLERIE', ammo: 1,  from: 3, mode: 'target', info: 'Ziel auf der Karte anklicken – 5 Granaten fallen vom Himmel.' },
    { id: 'ram',     name: 'Rammstoß',         short: 'RAMMEN',     ammo: -1, from: 1, mode: 'now',    info: 'Vollgas nach vorn. Schiebt einen Gegner direkt vor dir weg – ideal Richtung Wasser.' },
    { id: 'repair',  name: 'Reparatur',        short: 'REPARATUR',  ammo: 1,  from: 1, mode: 'now',    info: '+30 Panzerung, beendet aber deinen Zug.' },
    { id: 'skip',    name: 'Aussetzen',        short: 'AUSSETZEN',  ammo: -1, from: 1, mode: 'now',    info: 'Zug sofort beenden.' },
  ];

  // Rufnamen der Panzer (Persönlichkeit!)
  const CALLSIGNS = ['Brocken', 'Wumme', 'Klotz', 'Dampfer', 'Rammbock', 'Eisenherz', 'Donner', 'Bulle', 'Grizzly', 'Hammer',
    'Kessel', 'Mörser', 'Brummer', 'Schotter', 'Keiler', 'Ambos', 'Granit', 'Hagel', 'Wolke', 'Sturkopf', 'Bollwerk', 'Funke', 'Zunder', 'Kraterkönig'];

  const TEAM_COLORS = ['#D9483B', '#3D8FD9', '#E8892B', '#E3C23A', '#E8E8E8', '#A57BE0'];
  const TEAM_NAMES  = ['Rot', 'Blau', 'Orange', 'Gelb', 'Weiß', 'Violett'];

  // Optik der Karte (Farben)
  const THEMES = [
    { name: 'Feldgrau', sky1: '#7D878C', sky2: '#C3C6BC', hills: '#8A8F80', smoke: '#5B5F5E',
      top1: [112, 121, 66], top2: [90, 98, 54], d1: [80, 70, 54], d2: [62, 54, 41], water: '#3A4F55' },
    { name: 'Wüste', sky1: '#B97A55', sky2: '#EBCB9C', hills: '#C9A479', smoke: '#6B5A4A',
      top1: [214, 184, 132], top2: [196, 162, 112], d1: [176, 138, 92], d2: [150, 114, 74], water: '#3E6E78' },
    { name: 'Winter', sky1: '#6F7C88', sky2: '#C4CCD3', hills: '#9AA6B0', smoke: '#59626B',
      top1: [236, 241, 245], top2: [205, 214, 222], d1: [96, 102, 112], d2: [76, 81, 90], water: '#3B5568' },
    { name: 'Dämmerung', sky1: '#2E3442', sky2: '#9A7F6E', hills: '#4F4C52', smoke: '#2A2C33',
      top1: [96, 100, 62], top2: [74, 78, 48], d1: [58, 50, 42], d2: [44, 38, 32], water: '#263640' },
  ];

  // Form des Geländes
  const MAPS = [
    { id: 'huegel', name: 'Hügelland', info: 'Sanfte Hügel, ein paar Höhlen und schwebende Felsen.' },
    { id: 'inseln', name: 'Inselkette', info: 'Einzelne Inseln, dazwischen tiefes Wasser.' },
    { id: 'bruecken', name: 'Brücken', info: 'Zwei Hochebenen mit Betonbrücken und Bunkern.' },
    { id: 'hoehlen', name: 'Höhlen', info: 'Dickes Erdreich voller Tunnel – Deckung überall.' },
  ];

  // Tarnmuster (Panzer gestalten)
  const CAMOS = [
    { id: 'oliv',   name: 'Oliv',    base: '#5E6B3A', turret: '#6A7744', dark: '#2F3520', spot: '#47522B', pat: 'spots' },
    { id: 'wald',   name: 'Wald',    base: '#4E5E34', turret: '#5A6B3C', dark: '#26301A', spot: '#6B5534', pat: 'blobs' },
    { id: 'wueste', name: 'Wüste',   base: '#B49A6A', turret: '#C2A878', dark: '#5E4E34', spot: '#9C7F52', pat: 'blobs' },
    { id: 'winter', name: 'Winter',  base: '#C9CED2', turret: '#D8DCDF', dark: '#4A5156', spot: '#8E979C', pat: 'blobs' },
    { id: 'stadt',  name: 'Stadt',   base: '#6F747A', turret: '#7D8288', dark: '#2E3236', spot: '#4E5358', pat: 'digital' },
    { id: 'tiger',  name: 'Tiger',   base: '#B5853E', turret: '#C29149', dark: '#3A2A14', spot: '#3A2A14', pat: 'stripes' },
    { id: 'nacht',  name: 'Nacht',   base: '#2E3238', turret: '#383D44', dark: '#121417', spot: '#23262B', pat: 'spots' },
  ];
  // Kopfbedeckung des Klecks-Kommandanten
  const HATS = [
    { id: 'none', name: 'Ohne' },
    { id: 'helm', name: 'Stahlhelm' },
    { id: 'barett', name: 'Barett' },
    { id: 'muetze', name: 'Offiziersmütze' },
    { id: 'kappe', name: 'Panzerkappe' },
    { id: 'krone', name: 'Krone' },
  ];

  const BOT_LEVELS = [
    { id: 1, name: 'Rekrut' },
    { id: 2, name: 'Veteran' },
    { id: 3, name: 'Elite' },
  ];
  const BOT_NAMES = ['Oberst Kruste', 'Major Matsch', 'Hauptmann Haubitze', 'Leutnant Lehm', 'Feldwebel Funke', 'Gefreiter Glibber'];

  // Physik – identisch auf Gastgeber und in der Zielhilfe
  const PHYS = {
    G: 0.2,                       // Schwerkraft px/Tick²
    speed: (power) => 2 + power * 0.15,   // Kraft 0..100 -> Mündungsgeschwindigkeit
    MUZZLE: 18,                   // Abstand Drehpunkt -> Mündung
    PIVOT_X: 7.0, PIVOT_Y: -4.8,  // Drehpunkt des Rohrs relativ zur Panzermitte (nach rechts schauend)
    AIM_MIN: -15, AIM_MAX: 85,
    CONCRETE: 0.45,               // Beton wird nur zu diesem Anteil des Explosionsradius zerstört
  };

  return {
    WEAPONS, CALLSIGNS, TEAM_COLORS, TEAM_NAMES, THEMES, MAPS, CAMOS, HATS, BOT_LEVELS, BOT_NAMES, PHYS,
    TANK_R: 10, W: 2000, H: 1000, MAX_PLAYERS: 6, PEER_PREFIX: 'stahlfront-v1-',
  };
});
