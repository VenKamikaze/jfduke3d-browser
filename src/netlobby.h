// Hosting and joining a network game through a vnet relay from inside the game (brief 05):
// the start-up wait ("lobby"), "start now", the console and menu commands that restart into a
// network game, and the end of a network game whose host or guest has vanished.
// See netlobby.c, and jfbuild/include/mmulti_vnet.h for the transport side. (jfSW's src/netlobby.c,
// with Duke's differences: doco/browser/05-host-and-join.md.)

#ifndef NETLOBBY_H
#define NETLOBBY_H

#ifdef __cplusplus
extern "C" {
#endif

// The relay for host/join natively (duke3d.cfg, [Comm Setup] Relay = HOST:PORT). A -net -relay
// HOST:PORT on the command line is remembered here. The browser uses its page's config.js.
extern char NetRelay[128];

// The most players a hosted online game can have: the relay's room size (8), 4 on the shareware data.
#define NET_HOSTMAX_REGISTERED 8
#define NET_HOSTMAX_SHAREWARE  4

// app_main, first thing (before it changes directory): the command line and the directory, for a re-launch.
void NetSetArgs(int argc, char const * const argv[]);
// app_main, once the log is open: a re-launched game says so in its new log.
void NetLogRelaunch(void);
// app_main, after a successful -net: remember a -relay HOST:PORT among those arguments.
void NetNoteRelayArg(int argc, char const * const argv[]);

// Startup()'s wait for the other players (it replaces the loop on initmultiplayerscycle()). Plain
// UDP waits exactly as before. A relay game also feeds the lobby (the browser page's overlay, the
// GTK startup window, the console) and takes "start now" and "cancel" from it. Returns 0 if the
// game is to quit (quitevent), else 1 (the caller checks mmulti_vnet_state() for FAILED).
int NetLobbyWait(void);

// 1 when this game can host or join an online game now: the data allows network games (the
// shareware gate, D14) and this machine is not in a network game or a demo already. The menu's
// entries show only then.
int NetOnlineAvailable(void);
// The most players a game hosted with this data can have.
int NetHostMax(void);

// Restart into a network game through the relay (D3): host one of PLAYERS places (code NULL), or
// join the room CODE. In the browser the page reloads with ?host=N / ?join=CODE; natively the game
// leaves (gameexit) and re-launches itself with -net -relay ... -host-room N / -room CODE, and
// does not return then. Returns 1 if the restart is under way (the browser), 0 (after printing why)
// if it cannot be done. Never exits when it cannot.
int NetRestart(int players, const char *code);
// Is CODE a room code (6 of A-Z without I and O, 2-9, any case)? Upper-cased into OUT[7].
int NetIsRoomCode(const char *code, char *out);

// gameexit(), just before exit(0): carry out a re-launch NetRestart() asked for (it does not
// return then). NetRelaunchPending(): 1 while one is pending.
int NetRelaunchPending(void);
void NetRelaunch(void);

// The arguments for -net from the startup window's online choices: -relay NetRelay and
// -host-room N (HOSTROOM > 1) or -room CODE. OUT gets up to 6 pointers (into static storage).
// Returns the count, 0 if no online game was chosen, -1 (after a message) if it cannot be made.
int NetStartwinArgs(const char **out, int hostroom, const char *joinroom);

// From getpackets(): in a relay game, end the game with a message when the host (on a slave) or
// a guest (on the master) has not been heard from for NET_GONE_MS (it vanished: a guest that
// quits properly is taken out of the game by domovethings(), which is not this), or the relay
// session failed and nothing more moves. The master tells the remaining players who left.
void NetGoneCheck(void);
#define NET_GONE_MS 15000

// domovethings(): the master left the game. In a relay game the end message says so plainly.
// Returns the text to give gameexit() (the original's, for plain UDP).
const char *NetMasterQuitText(void);

#ifdef __cplusplus
}
#endif

#endif
