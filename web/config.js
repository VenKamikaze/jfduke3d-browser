// Settings of the page, edited by a person who hosts the game (the same file as jfSW's, with what later briefs bring left out:
// the game data's url, size and checksum are brief 03's).
//
// testMode: false (the default, and what a public site must keep). true lets a page address with ?test=1
//        use the test hooks and test-only parameters (?args=, ?files=, ?persist=, ...; see the top of jfduke3d.js).
//        The browser tests serve a config.js with testMode: true. It is a setting and not a link parameter so that a
//        crafted link cannot give a visitor's game test arguments or loose game files.
//
// relay: the vnet relay for network games (brief 05). Empty (the default). Not used yet: the page starts no network game.
window.JFSW_CONFIG = {
  testMode: false,
  relay: '',
};
