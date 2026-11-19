// Test-only hooks (brief 01; doco/browser/01-native-relay.md). Used by the network tests, never by
// players. The names, and what they do, are those of jfsw-browser's src/sync.c, so that both games'
// tests read alike.
//
// Arguments:
//   -testsync          every tic, not every 8th, each machine adds a sync byte (a fold of the hash of
//                      the whole simulation state, below) to its packets, so the game's own check
//                      sees any divergence at once. Every player of a game must be given it (it is
//                      added to the version byte of the player announcement, packet 6, so a player
//                      without it is refused: "You cannot play Duke with different versions.").
//   -testquit<N>       quit cleanly (status 0) after the N-th game tic of the level. Works in network
//                      games, single player and demo playback; every player of a network game
//                      should be given the same N (one that stops early stops the others).
//   -testnudge<T>      this player moves 8 units in x at tic T: a deliberate desync, for proving that
//                      the sync check and -testdump bite.
//   -testdump<name>    this machine writes a record of every game tic to the file <name>, in every
//                      kind of game (network, single player, demo playback), see testhooks.c.
//   -teststate[<T>]    with -testdump: also <name>.state, the state as text at tics 1, 2 and T.
//   -testexit<T>       (A1) at game tic T of the first level the level ends, the way a level-end sector
//                      ends it (the CON/sector "timebeforeexit" countdown that player.c's processinput
//                      runs: MODE_EOL for every player and the next level number, inside the tic, the
//                      same tic on every machine). Every player must be given it (version byte).
//   -teststall<T>,<ms> (A1) this machine stops for <ms> ms at the start of game tic T of the first
//                      level (after -testexit's tic if it is the same), its clock running: the other
//                      machines go on, and it comes back with the inputs of many more tics in its
//                      fifo. Per machine; changes nothing in the simulation.
//   -testfire[<N>]     (A1) from game tic N of the first level on (from the start without N) and in
//                      every later level, this machine's own inputs select the chaingun and hold fire
//                      (the inputs travel as any other), so the ammo count changes every few tics. It also
//                      gives every player the starting weapons and 300 chaingun rounds at tic 1, so every
//                      player must be given it (version byte).
//   -testlate<T>,<ms>  (04) this machine makes its input for game tic T of the first level, then stops for <ms> ms
//                      before it sends it, and so sends it and the inputs after it late (a slave whose inputs for the
//                      tics after a level's last tic reach the master after it has left the level: bugs.md D11). Per
//                      machine; changes nothing in the simulation.
//   -testmenu          (D3) "TEST: menu N" is printed whenever the menu of a game opens, changes or closes.
//   -testpredict       (A1) every call of fakedomovethings() (the prediction of the local player's moves) is
//                      checked: the raw bytes of every table of the simulation are hashed before and after
//                      it, and "TEST: prediction ... changed the simulation" is logged for a difference
//                      (the count is in the line -testquit prints).
//   -testdrawcheck     (04) the raw bytes of every table of the simulation are compared just before and just after
//                      displayrooms() and displayrest(); what drawing writes that lasts is logged once per field
//                      ("TEST: draw check: ...") and counted (the line -testquit prints). code-facts.md section 20.
//   -testnodraw        (04) this machine plays as a hidden browser tab does: no picture, HiddenNetPass() makes the
//                      inputs and runs the moves (a network game only). It changes nothing in the simulation.
//   -testcam<T>,<n>    (04) at game tic T of the first level every machine puts every player in front of the n-th
//                      security monitor, facing it, and from tic T+2 for four tics every player presses the use key.
//   -testmirror<T>,<n> (04) the same in front of the n-th mirror, with the RPG fired from tic T+60 on. Both change the
//                      simulation: every player must be given them (version byte).
// Everything is off without its argument, and nothing here goes on the wire except -testsync
// and -testexit (the version byte of packet 6).

#ifndef TESTHOOKS_H_
#define TESTHOOKS_H_

#ifdef __cplusplus
extern "C" {
#endif

extern int TestSyncOn;          // -testsync
extern int TestQuitTics;        // -testquit<N>; 0 = off
extern int TestNudgeTic;        // -testnudge<T>; -1 = off

void TestSyncArg(void);
void TestQuitArg(int tics);
void TestNudgeArg(int tic);
void TestDumpArg(const char *name);
void TestExitArg(int tic);
void TestStallArg(const char *arg);
void TestFireArg(int tic);
void TestArmArg(void);          // -testarm: every weapon with full ammo, and full health, in every tic (D15's demos); in the version byte
void TestPredictArg(void);
void TestMenuArg(void);
void TestLateArg(const char *arg);      // "<T>,<ms>"
void TestDrawCheckArg(void);
void TestNoDrawArg(void);
void TestCamArg(const char *arg);       // "<T>,<n>"
void TestMirrorArg(const char *arg);
extern int TestNoDrawOn;                // -testnodraw
void TestDrawBegin(void);               // -testdrawcheck: around displayrooms() and displayrest() (game.c)
void TestDrawEnd(const char *what);
void TestPredictBegin(void);    // fakedomovethings(), at its start and its end (-testpredict)
void TestPredictEnd(void);
void TestStateArg(int tic);     // -teststate[<T>]: with -testdump, also <name>.state, the state as text (tics 1, 2 and T)

// Called every frame from displayrest() (-testmenu): prints "TEST: menu N" when the menu in a game changes
// (N is current_menu while MODE_MENU is set, -1 when the game is not in a menu).
void TestMenuPoll(void);

// Called from faketimerhandler() right after the local input is made (-testfire).
void TestInputHook(void);

// Called from the main loop when it finds MODE_EOL (-testexit, -teststall): "TEST: left the level
// after tic T, with the inputs of K more tics here".
void TestLevelEnd(void);

// Added to the version byte of packet 6: 8 for -testsync, 16 for -testexit, 32 for -testfire, 64 for -testarm, 1 for -testcam, 2 for -testmirror
// (0 without them), so that machines started with different ones refuse each other.
int TestVersionSalt(void);

// domovethings(), when a tic is going to run: the state before it is hashed (and written with
// -testdump), the nudge is applied. TestTicEnd(), at its end: -testquit.
void TestTicHook(void);
void TestTicEnd(void);

// The sync byte that -testsync puts in place of the usual one (it is taken at the same place in
// domovethings(), after the tic's inputs are taken and before the tic is moved).
unsigned char TestSyncByte(void);

// The game tic that sync byte number INDEX stands for (1-based, counted from the start of the level).
int TestSyncTic(int index);

#ifdef __cplusplus
}
#endif

#endif
