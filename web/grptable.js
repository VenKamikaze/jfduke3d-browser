// The GRP files the game knows: a copy of the grpfiles[] table in src/grpscan.c (name, CRC-32, size, kind, file name).
// Generated: node tests/web/grptable.js --write. tests/web/grptable.js checks the two against each other, so they cannot drift apart.
//   game: DUKE (registered), DUKESW (shareware), NAM, as GAMEGRP_GAME_* in grpscan.c.
// The page starts the game with DUKE and DUKESW entries only (NAM is for later).
window.JFSW_GRPS = [
  { name: 'Registered Version 1.3d', crc: 'bbc9ce44', size: 26524524, game: 'DUKE', file: 'duke3d13.grp' },
  { name: 'Registered Version 1.4', crc: 'f514a6ac', size: 44348015, game: 'DUKE', file: 'duke3d14.grp' },
  { name: 'Registered Version 1.5', crc: 'fd3dcff1', size: 44356548, game: 'DUKE', file: 'duke3d.grp' },
  { name: '20th Anniversary', crc: '982afe4a', size: 44356548, game: 'DUKE', file: 'duke3d20th.grp' },
  { name: 'Shareware Version', crc: '983ad923', size: 11035779, game: 'DUKESW', file: 'duke3dshare.grp' },
  { name: 'Mac Shareware Version', crc: 'c5f71561', size: 10444391, game: 'DUKESW', file: 'duke3dmacshare.grp' },
  { name: 'NAM', crc: '75c1f07b', size: 43448927, game: 'NAM', file: 'nam.grp' },
];
