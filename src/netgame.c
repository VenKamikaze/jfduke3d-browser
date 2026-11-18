// Network glue between the game and mmulti (brief 01; see netgame.h and
// doco/browser/01-native-relay.md). Nothing in here changes the simulation or the packets.

#include "duke3d.h"
#include "mmulti_vnet.h"
#include "netgame.h"
#include "testhooks.h"

// ---- The shareware network gate (D14) ----------------------------------------------------------

int32 AllowSharewareNetCmd = 0;

int NetGameAllowedFor(int game)
{
    return game != GAMEGRP_GAME_DUKESW || AllowSharewareNet || AllowSharewareNetCmd;
}

int NetDataIsShareware(void)
{
    int fh;

    if (VOLUMEONE) return 1;
    // 0: the file system and ZIPs first, then every mounted group file (main and -g)
    fh = kopen4load("DUKESW.BIN", 0);
    if (fh < 0) return 0;
    kclose(fh);
    return 1;
}

int NetGameAllowed(void)
{
    return !NetDataIsShareware() || AllowSharewareNet || AllowSharewareNetCmd;
}

void NetRefuseShareware(void)
{
    static const char *why =
        "Network games are switched off for the shareware version of Duke Nukem 3D.\n"
        "Its licence does not allow online multiplayer services, so shareware network games\n"
        "are meant for a local network only. If you are on one, allow them with\n"
        "AllowSharewareNetGames = 1 under [Comm Setup] in duke3d.cfg, or start the game with\n"
        "-allowsharewarenet. The registered version has no such limit.";

    buildprintf("Network game refused: %s\n", why);
    uninitmultiplayers();
    wm_msgbox("Network game refused", "%s", why);
    exit(1);
}

// ---- Failures of a relay game ------------------------------------------------------------------

void NetFailExit(const char *why)
{
    buildprintf("Network game failed: %s\n", why);
    uninitmultiplayers();
    wm_msgbox("Network game failed", "%s.", why);
    exit(1);
}

void NetFailIfRelayFailed(void)
{
    // (mmulti has said why on the console already.) Only relay games ever get here: FAILED is a
    // relay state. A plain -net that cannot start still falls back to a single player game, as before.
    if (mmulti_vnet_state() == MMULTI_VNET_FAILED)
        NetFailExit(mmulti_vnet_errormsg());
}

void NetLostCheck(void)
{
    static int lostplc = -1;
    static unsigned int lostsince;

    if (numplayers < 2 || mmulti_vnet_state() != MMULTI_VNET_FAILED) {
        lostplc = -1;
        return;
    }
    if (movefifoplc != lostplc) {
        lostplc = movefifoplc;
        lostsince = getticks();
    } else if (getticks() - lostsince > 2000) {
        NetFailExit(mmulti_vnet_errormsg());
    }
}

// ---- The sync check's log ----------------------------------------------------------------------

int NetSyncChecks, NetSyncMismatches;
static int syncbad;     // the previous comparison differed (so the next difference is not news)
static int syncdiffered;    // this comparison has differed

void NetSyncChecked(int index)
{
    (void)index;
    NetSyncChecks++;
    syncbad = syncdiffered;
    syncdiffered = 0;
}

void NetSyncDiffers(int index, int player)
{
    NetSyncMismatches++;
    if (!syncbad && !syncdiffered)
        buildprintf("GAME OUT OF SYNC: sync check %d (tic %d), player %d differs from the master\n",
            index, TestSyncTic(index), player);
    syncdiffered = 1;
}
