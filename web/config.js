// Where the page gets the game data, and the page's other settings (brief 03). A person hosting the game
// edits this file. Read doco/browser/data-hosting.md before changing it. (The same file as jfSW's, with
// what later briefs bring left out.)
//
//   data.url    The GRP to download: relative to the page, or a full URL. A full URL on another
//               origin needs CORS headers (Access-Control-Allow-Origin) on the server.
//               Only the shareware GRP may be offered for public download by default.
//   data.size   Expected size in bytes (0 = not declared). With it the progress bar is right even
//               when the server compresses the response, and a truncated or wrong file is
//               refused before anything else is looked at.
//   data.crc32  Expected CRC-32 as 8 hex digits ('' = not declared). The page always checks the
//               file against the table of GRPs the game knows (grptable.js) as well.
//   data.revalidate  false (default): once the file is stored in the browser, a reload makes no request
//               for it. true: each load asks the server "has it changed?" (If-None-Match /
//               If-Modified-Since); a 304 answer costs a few hundred bytes. The server must send
//               an ETag or Last-Modified, and on another origin must allow those request headers.
//
// Changing data.url, data.size or data.crc32 makes every browser download the file again on its next visit
// and forget the copy it had of the old url.
//
// ?data=<url> in the page address overrides data.url (and size and crc32 are then not checked).
//
// allowSharewareNetGames: false (the default, and what a public site must keep). With the shareware game data
//        the game refuses network games unless they are allowed, because the shareware licence (clause
//        [3][D]) does not let anyone offer an online multiplayer service with it. true makes the page start
//        the game with -allowsharewarenet. Set it only for a deployment that is a LAN (a private network of
//        people who each have the right to play the shareware version, say a party or a classroom), and
//        never for a public site. It is taken only from this file, never from the page address: a link
//        cannot switch it on. The browser plays network games since brief 04 (the tests start them with ?test=1&args=; the
//        host and join pages come with brief 05); the game data the player
//        picks with "Use your own copy" can be registered data, which always allows them (decision D14).
//
// relay: the vnet relay for network games (brief 05). Empty (the default). Not used yet: the page starts no network game.
//
// testMode: false (the default, and what a public site must keep). true lets a page address with ?test=1
//        use the test hooks and test-only parameters (?args=, ?files=, ?persist=, ...; see the top of jfduke3d.js).
//        In test mode the game also accepts a loose CON script in its folder (the game takes its scripts from the
//        GRP only otherwise). The browser tests serve a config.js with testMode: true. It is a setting and not a
//        link parameter so that a crafted link cannot give a visitor's game test arguments or loose game files.
window.JFSW_CONFIG = {
  testMode: false,
  relay: '',
  allowSharewareNetGames: false,
  data: {
    url: 'duke3dshare.grp',
    size: 11035779,
    crc32: '983ad923',
    revalidate: false
  }
};
