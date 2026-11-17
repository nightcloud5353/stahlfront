// STAHLFRONT – gemeinsame Definitionen (Gastgeber-Simulation + Darstellung)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SHARED = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
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
    { id: 'winch',   name: 'Seilwinde',        short: 'SEILWINDE',  ammo: 3,  from: 1, mode: 'aim',    info: 'Haken in Rohrrichtung abschießen – die Winde zieht dich hin. Beendet den Zug NICHT, danach kannst du noch schießen.' },
    { id: 'repair',  name: 'Reparatur',        short: 'REPARATUR',  ammo: 1,  from: 1, mode: 'now',    info: '+30 Panzerung, beendet aber deinen Zug.' },
    { id: 'skip',    name: 'Aussetzen',        short: 'AUSSETZEN',  ammo: -1, from: 1, mode: 'now',    info: 'Zug sofort beenden.' },
    // neue Waffen (Tasten Umschalt+1/2/3, damit 1–0 wie gewohnt bleiben)
    { id: 'napalm',  name: 'Napalm',           short: 'NAPALM',     ammo: 1,  from: 3, mode: 'fire',   info: 'Setzt den Boden in Brand. Das Feuer fließt hangabwärts, brennt 2 Runden und verletzt jeden, der darin steht. Wasser löscht.' },
    { id: 'c4',      name: 'Sprengladung',     short: 'C4',         ammo: 1,  from: 2, mode: 'now',    info: 'Wird vor dir abgelegt und explodiert zu Beginn deines NÄCHSTEN Zuges – sehr stark. Gegner können flüchten oder sie wegsprengen.' },
    { id: 'nuke',    name: 'Atomgranate',      short: 'ATOM',       ammo: 0,  from: 5, mode: 'fire',   info: 'Riesiger Krater, alles in der Nähe fliegt weg. Gibt es nur selten aus Nachschub-Kisten – Abstand halten!' },
  ];

  // Rufnamen der Panzer (Persönlichkeit!)
  const CALLSIGNS = ['Brocken', 'Wumme', 'Klotz', 'Dampfer', 'Rammbock', 'Eisenherz', 'Donner', 'Bulle', 'Grizzly', 'Hammer',
    'Kessel', 'Mörser', 'Brummer', 'Schotter', 'Keiler', 'Ambos', 'Granit', 'Hagel', 'Wolke', 'Sturkopf', 'Bollwerk', 'Funke', 'Zunder', 'Kraterkönig'];

  const TEAM_COLORS = ['#D9483B', '#3D8FD9', '#E8892B', '#E3C23A', '#E8E8E8', '#A57BE0'];
  const TEAM_NAMES  = ['Rot', 'Blau', 'Orange', 'Gelb', 'Weiß', 'Violett'];

  // Optik der Karte (Farben)
  const THEMES = [
    { name: 'Feldgrau', ground: 'grass', sky1: '#7D878C', sky2: '#C3C6BC', hills: '#8A8F80', smoke: '#5B5F5E',
      top1: [112, 121, 66], top2: [90, 98, 54], d1: [80, 70, 54], d2: [62, 54, 41], water: '#3A4F55' },
    { name: 'Wüste', ground: 'sand', sky1: '#B97A55', sky2: '#EBCB9C', hills: '#C9A479', smoke: '#6B5A4A',
      top1: [214, 184, 132], top2: [196, 162, 112], d1: [176, 138, 92], d2: [150, 114, 74], water: '#3E6E78' },
    { name: 'Winter', ground: 'snow', sky1: '#6F7C88', sky2: '#C4CCD3', hills: '#9AA6B0', smoke: '#59626B',
      top1: [236, 241, 245], top2: [205, 214, 222], d1: [96, 102, 112], d2: [76, 81, 90], water: '#3B5568' },
    { name: 'Dämmerung', ground: 'grass', sky1: '#2E3442', sky2: '#9A7F6E', hills: '#4F4C52', smoke: '#2A2C33',
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
    // Vorbilder aus der Wirklichkeit (Farben nach RAL/FS, für den Bildschirm leicht aufgehellt) – außer dem Einhorn
    { id: 'oliv', name: 'Oliv', info: 'NATO-Gelboliv (RAL 6014), einfarbig – so fuhr die Bundeswehr bis 1984',
      base: '#56563A', turret: '#5F6042', cols: [], pat: 'uni', swatch: '#56563A' },
    { id: 'wald', name: 'Wald', info: 'Bundeswehr-Dreifarbtarn (seit 1984): Bronzegrün, Lederbraun, Teerschwarz',
      base: '#4A563D', turret: '#525F44', cols: ['#5E4A38', '#232521'], pat: 'nato',
      swatch: 'linear-gradient(135deg, #4A563D 0 40%, #5E4A38 40% 70%, #232521 70%)' },
    { id: 'wueste', name: 'Wüste', info: 'Wüstentarn: Sandbeige mit Sandbraun und Graugrün',
      base: '#C3A979', turret: '#CDB383', cols: ['#937252', '#6E6D51'], pat: 'desert',
      swatch: 'linear-gradient(135deg, #C3A979 0 50%, #937252 50% 78%, #6E6D51 78%)' },
    { id: 'winter', name: 'Winter', info: 'Winter-Kalkanstrich über Oliv – abwaschbar, mit der Zeit abgewetzt',
      base: '#E2E5E1', turret: '#EAEDE9', cols: ['#5E6342', '#A6ABA2'], pat: 'whitewash',
      swatch: 'linear-gradient(135deg, #E2E5E1 0 62%, #A6ABA2 62% 78%, #5E6342 78%)' },
    { id: 'stadt', name: 'Berlin', info: 'Stadttarn der US-Berlin-Brigade (1980er): eckige Flächen in Hell-, Mittel- und Dunkelgrau',
      base: '#808487', turret: '#888C8F', cols: ['#C6C7C2', '#3C3E42'], pat: 'berlin',
      swatch: 'linear-gradient(135deg, #C6C7C2 0 34%, #808487 34% 67%, #3C3E42 67%)' },
    { id: 'tiger', name: 'Tiger', info: 'Dreifarbtarnung 1943: Dunkelgelb mit Olivgrün und Rotbraun, dazu Hinterhalt-Punkte',
      base: '#BF9F5E', turret: '#C8A866', cols: ['#4F5637', '#6B3F2B', '#D6B978'], pat: 'tiger',
      swatch: 'linear-gradient(135deg, #BF9F5E 0 40%, #4F5637 40% 70%, #6B3F2B 70%)' },
    { id: 'splitter', name: 'Splitter', info: 'Schwedischer Splittertarn M90 (CV90, Strv 122): kantige Splitter in Grün und Schwarz',
      base: '#7F8C5F', turret: '#879566', cols: ['#4F5F39', '#2C3725', '#1C1E19'], pat: 'splitter',
      swatch: 'linear-gradient(135deg, #7F8C5F 0 34%, #4F5F39 34% 60%, #2C3725 60% 82%, #1C1E19 82%)' },
    { id: 'einhorn', name: 'Einhorn', info: 'Garantiert nicht aus dem Dienstvorschriften-Handbuch',
      base: '#F28DC0', turret: '#F7A8D1', cols: ['#FFFFFF'], pat: 'unicorn',
      swatch: 'linear-gradient(135deg, #F28DC0 0 45%, #FFC27A 45% 55%, #FFF08A 55% 65%, #9EEBB0 65% 75%, #8FD3FF 75% 85%, #C3A6FF 85%)' },
  ];
  // Kopfbedeckung des Klecks-Kommandanten
  const HATS = [
    { id: 'none', name: 'Ohne' },
    { id: 'helm', name: 'Stahlhelm' },
    { id: 'barett', name: 'Barett' },
    { id: 'muetze', name: 'Offiziersmütze' },
    { id: 'kappe', name: 'Panzerkappe' },
    { id: 'morion', name: 'Morion' },
    { id: 'pickel', name: 'Pickelhaube' },
    { id: 'horn', name: 'Einhorn-Horn' },
  ];

  // Sprüche der Klecks-Kommandanten (eigene Texte)
  const LINES = {
    turn: ['Ich bin dran!', 'Feuer frei!', 'Zielen, atmen, BUMM.', 'Lasst mich nur machen.', 'Klecks meldet sich zum Dienst!', 'Kanone geladen!', 'Wo versteckt ihr euch?', 'Jetzt wird’s laut!', 'Heute treff ich alles!', 'Achtung, jetzt komm ich!'],
    lowhp: ['Mir geht’s prima… wirklich.', 'Nur ein Kratzer!', 'Ich brauch Urlaub.', 'Hält schon noch… irgendwie.', 'Wer hat meinen Panzer zerbeult?!'],
    taunt: ['Du triffst eh nicht!', 'Na, Angst?', 'Ich hab Zeit…', 'Schieß doch, wenn du dich traust!', 'Mein Opa zielt besser!', 'Gähn…', 'Das wird nix!'],
    fire: ['Abschuss!', 'Fass!', 'Ab die Post!', 'Geschenk unterwegs!', 'Und tschüss!', 'Flieg, mein Kleiner!', 'Zustellung läuft!'],
    hit: ['Treffer!', 'Das saß!', 'Lehrbuchschuss!', 'Mitten ins Blech!', 'Hab ich doch gesagt!', 'Schön gezielt, ich!', 'Volle Breitseite!'],
    hurt: ['Aua!', 'Mein Lack!', 'Das gibt ’ne Delle!', 'Hey, nicht so fest!', 'Autsch!', 'Das merk ich mir!'],
    hurtbig: ['Mein schöner Panzer!', 'Ich seh Sternchen!', 'Wer hat das Licht ausgemacht?', 'Das war gemein!', 'Mama!'],
    self: ['Ups.', 'Das war Absicht!', 'Nicht nachmachen!', 'Peinlich…', 'Hat das wer gesehen?', 'Falsche Richtung…'],
    miss: ['Der Wind war schuld!', 'Warnschuss!', 'Gleich nochmal…', 'Ich üb noch.', 'Absichtlich daneben!', 'Von wo bis wo?'],
    drown: ['Ich kann nicht schwimmen!', 'Blubb!', 'Wasser marsch…', 'Rettungsring!', 'Deux cent mètres planche!'],
    death: ['Ich komme wieder!', 'Sagt meiner Mama…', 'Das war’s dann…', 'Abgang mit Stil!', 'Nicht fair!'],
    pickup: ['Weihnachten!', 'Nachschub, juhu!', 'Mis Schätzli!', 'Danke, Luftpost!'],
    ram: ['Aus dem Weg!', 'Platz da!', 'Rammbock-Zeit!'],
    mine: ['Vorsicht, Stufe!', 'Kleines Geschenk…', 'Nicht drauftreten!'],
    strike: ['Luftpost!', 'Achtung, von oben!', 'Ich hab Freunde da oben!'],
    winch: ['Festhalten!', 'Abschleppdienst!', 'Hoch mit dir!'],
    c4: ['Tick, tack…', 'Nicht anfassen!', 'Ein Paket für euch!'],
    napalm: ['Grillabend!', 'Heiß, heiß, heiß!', 'Wer hat Marshmallows?'],
    nuke: ['Ohren zuhalten!', 'Das wird ein großer Knall!', 'Lauft, solange ihr könnt!'],
    burn: ['Es brennt!', 'Heiß hier!', 'Feuer unterm Hintern!'],
    repair: ['Klebeband hält alles!', 'Wie neu!', 'Ein bisschen Spucke…'],
    hurry: ['Schnell, schnell!', 'Die Uhr tickt!', 'Äh… äh…'],
    win: ['Sieg! Kuchen für alle!', 'Ich bin der Größte!', 'Gut gekämpft, Leute!', 'Unbesiegbar! Yallah!'],
  };

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
    MUZZLE: 21,                   // Abstand Drehpunkt -> Mündung (= Rohrlänge des Kampfpanzers)
    PIVOT_X: 11.5, PIVOT_Y: -4.8, // Drehpunkt des Rohrs relativ zur Panzermitte (nach rechts schauend)
    AIM_MIN: -15, AIM_MAX: 85,
    WINCH_RANGE: 260,             // Reichweite des Seilwinden-Hakens
    SLIDE_NY: -0.57,              // steiler als ca. 55°: Panzer rutscht ab
    CONCRETE: 0.45,               // Beton wird nur zu diesem Anteil des Explosionsradius zerstört
  };

  // Kryptografisch sichere Zufallszeichen (Raumcodes, Spieler-Tokens) statt Math.random().
  // Verwirft Bytes oberhalb des größten Vielfachen der Alphabetlänge, damit jedes Zeichen gleich wahrscheinlich ist.
  const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
  function randomId(n, chars) {
    const abc = chars || ID_CHARS;
    const lim = 256 - (256 % abc.length);
    let s = '';
    while (s.length < n) {
      const buf = new Uint8Array(n * 2);
      globalThis.crypto.getRandomValues(buf);
      for (let i = 0; i < buf.length && s.length < n; i++) if (buf[i] < lim) s += abc[buf[i] % abc.length];
    }
    return s;
  }

  return {
    randomId,
    WEAPONS, CALLSIGNS, LINES, TEAM_COLORS, TEAM_NAMES, THEMES, MAPS, CAMOS, HATS, BOT_LEVELS, BOT_NAMES, PHYS,
    TANK_R: 10, W: 2000, H: 1000, MAX_PLAYERS: 6, PEER_PREFIX: 'stahlfront-v1-',
  };
});
