# Lesser bugs in the original game

Bugs found in upstream jfduke3d, jfbuild, jfaudiolib or vnet (at the pinned commits) while doing the browser work that **don't break the game**, or that break it only **in a feature a normal multiplayer game is unlikely to use** (marked **not planned**). Game-breaking, reproducible bugs get their own fix brief instead (see "Bugs found in the original game" in [`README.md`](README.md)). Nothing here has been sent upstream.

Each entry: where, what happens, how it was found, and its state (**open**, **worked around** in a brief, **fixed** on a `fix/` branch, or **not planned**).

**Numbering.** The engine forks (jfbuild, jfaudiolib, jfmact) and vnet are shared with Shadow Warrior, and so are their bugs: those keep jfSW's **L-numbers**, which live in [`jfsw-browser`'s `doco/browser/bugs.md`](https://github.com/VenKamikaze/jfsw-browser/blob/claude/doco/browser/bugs.md) (L1 to L34 at the time of writing; for example L9 stale `libengine.a`, L10 `syncstate`, L15 `ar rc`, L18 a lost relay session, L24/L33 refused pointer lock, L31/L34 vnet's WebTransport). Don't copy them here; add a line below only when a Duke brief meets one and has something to say about it. Bugs in **Duke's own code** get **D-numbers** (D1, D2, …) in the table below, so the two sets never collide. (This split is the implementer's choice in brief 00; the coordinator may change it.)

| # | Where | What happens | Found in | State |
|---|---|---|---|---|

Candidates already seen while reading the code in brief 00 (written up in [`code-facts.md`](code-facts.md) §12, not yet numbered because nothing has reproduced them): `-nosetup` not stopping the startup window on a first run; a quit during the network wait returning from `Startup()` with initialisation unfinished; SIGTERM acting as the Escape key; packet 8 (user-map game) reading `ffire` from the map name and dropping its last character; `newgame` and the episode-3 end waiting for sounds to finish; the shareware order screens after a network exit; `myname` not re-sent; peer-to-peer limited to 2 players. The brief that touches each one decides whether to number it.
