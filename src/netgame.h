// Network glue between the game and mmulti (brief 01; doco/browser/01-native-relay.md).
//
// The game has no net.c of its own (the netcode lives in game.c); this file holds what the
// browser work adds around it: the shareware network gate (decision D14), the way a
// relay game fails (a bad -relay or room, a relay session lost during a game), and the
// log of the out-of-sync check. Nothing here changes the simulation or the packets.

#ifndef NETGAME_H_
#define NETGAME_H_

#include "types.h"      // int32 (jfmact)

#ifdef __cplusplus
extern "C" {
#endif

// ---- The shareware network gate (D14) -------------------------------------------------------
//
// With the shareware GRP (VOLUMEONE) network games are refused unless the player allows them:
// the shareware licence ([3][D]) does not give 3D Realms' permission for an "online service
// providing multiplayer use", so shareware netplay is meant for a local network only. Two
// switches allow it:
//   * the configuration file: [Comm Setup] AllowSharewareNetGames = 1 (default 0; CONFIG_ReadSetup
//     and CONFIG_WriteSetup; AllowSharewareNet in config.c);
//   * the command line: -allowsharewarenet (for tests, and for a page or launcher that knows
//     what it does; it is not written to the configuration file).
// Registered data (any GRP but the shareware one) always allows network games. The gate covers
// plain UDP (-net) and relay games (-net -relay ...) alike, and the startup window's Join and
// Host. Later entry points (the menu and console Host/Join) must ask NetGameAllowed() too.
extern int32 AllowSharewareNetCmd;      // -allowsharewarenet

// 1 when the data the game has mounted is shareware: gametype says so (VOLUMEONE), or a DUKESW.BIN
// (the shareware's marker, which the game itself guesses by when it cannot identify a GRP) can be
// opened from anywhere: the main GRP, a -g extra GRP, a ZIP, a loose file. Only meaningful once every
// group file is mounted. It does not change gametype (a registered game with a shareware -g add-on
// still behaves as registered; it just gets no network games).
int NetDataIsShareware(void);
// 1 when a network game may be started with the data that is mounted: the one authoritative check
// (app_main calls it after every group file is mounted; so must the later entry points).
int NetGameAllowed(void);
// 1 when a network game may be started with a main GRP of this kind (GAMEGRP_GAME_*): the early
// check, before the data is mounted. It may only refuse what NetGameAllowed() would refuse too.
int NetGameAllowedFor(int game);
// Say why not (stdout, the log and a message box) and exit with status 1. Closes the network
// first (uninitmultiplayers), so a relay room that was just made is left again.
void NetRefuseShareware(void);

// ---- Failures of a relay game ----------------------------------------------------------------

// "Network game failed: WHY" on stdout and the log, a message box, uninitmultiplayers(), exit(1).
void NetFailExit(const char *why);
// Call it where a relay game may have failed (after initmultiplayersparms, after the start-up
// wait): when mmulti_vnet_state() is FAILED, NetFailExit(mmulti_vnet_errormsg()).
void NetFailIfRelayFailed(void);
// Call it often from the places a game can wait for the others (the main loop, waitforeverybody):
// a relay session that was lost during a game (the relay timed us out or restarted, the room
// closed) ends the game with the reason and status 1 once nothing has moved for 2 s, instead of
// standing still for ever. A player who is only behind still has inputs to run and is left alone.
// (jfSW's L18.)
void NetLostCheck(void);

// ---- A hidden browser tab (brief 04) ---------------------------------------------------------

// A hidden tab has no animation frames and about one timer run a second, so a
// network game in it is driven by network events instead (jfbuild/src/sdlayer2.c: handleevents()
// waits for vnet's wake callback while the tab is hidden and a relay session exists) and draws
// nothing. app_main's loop calls HiddenNetPass() instead of the drawing half of its pass; it does
// what the drawing half would have done for the network. See its definition in netgame.c.
// 1 when this machine plays without drawing: the tab is hidden and a relay session exists (browser),
// or -testnodraw (test-only, any platform) in a network game. A hidden single player game pauses.
int NetHiddenTab(void);
void HiddenNetPass(void);

// ---- The sync check's log ---------------------------------------------------------------------

// checksync() calls these. A comparison of one sync byte of each player against the master's:
// NetSyncChecked() once per byte, NetSyncDiffers() for each player that differs. Both count (the
// tests read the counters) and the first difference of a run is logged with buildprintf:
//   GAME OUT OF SYNC: sync check N (tic T), player P differs from the master
// because the on-screen message is no use to a log or a test. (A sync byte stands for 8 game tics,
// or for 1 with -testsync.)
extern int NetSyncChecks, NetSyncMismatches;
void NetSyncChecked(int index);
void NetSyncDiffers(int index, int player);

#ifdef __cplusplus
}
#endif

#endif
