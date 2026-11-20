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

const char *NetSharewareGateText(void)
{
    return
        "Network games are switched off for the shareware version of Duke Nukem 3D.\n"
        "Its licence does not allow online multiplayer services, so shareware network games\n"
        "are meant for a local network only. If you are on one, allow them with\n"
        "AllowSharewareNetGames = 1 under [Comm Setup] in duke3d.cfg, or start the game with\n"
        "-allowsharewarenet. The registered version has no such limit.";
}

void NetRefuseShareware(void)
{
    const char *why = NetSharewareGateText();

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

// ---- A hidden browser tab (brief 04) -----------------------------------------------------------

int NetHiddenTab(void)
{
#ifdef __EMSCRIPTEN__
    if (jfbuild_browser_hidden_netgame()) return 1;
#endif
    // (playerswhenstarted: a game that began as a network game and has lost the others since still draws nothing, as the
    // browser's hidden tab does while its relay session lasts; brief 05: the quit message of a master that left shows
    // order screens on shareware data, which a hidden tab skips)
    return TestNoDrawOn && (numplayers > 1 || playerswhenstarted > 1);
}

// One pass of the game loop of a hidden browser tab in a network game, called by app_main's loop
// after moveloop() (which has received and moved every tic whose inputs are in) in place of
// cheats(), nonsharedkeys(), displayrooms(), displayrest(), checksync() and nextpage(). Nobody
// sees the picture, so none is made. What drawing would have done for the network is done here:
//   * Drawing is where the engine calls faketimerhandler() (the "timer interrupt" that makes this
//     player's input for a tic and sends it; engine.c calls it from inside its long drawing loops,
//     and the main loop calls it after nextpage(): code-facts.md 2.3). A pass that draws nothing
//     must call it itself, once for every input that is due by this tab's own clock (a bounded
//     few: catching up to its clock, never ahead of it), or every other player would wait for
//     this one's inputs.
//   * checksync() compares the sync bytes. A hidden tab that never compared would let the ring of
//     MOVEFIFOSIZ (256) sync bytes wrap and report false differences when it was shown again.
//     (checksync() draws "Out Of Sync" with printext256() when it must: harmless.)
//   * mmulti puts at most one datagram per peer on the wire every 25 ms (PAKRATE), and
//     getpackets(), which faketimerhandler() calls before it makes the input, can spend that
//     window on an acknowledgement; the input would then wait for the next network event, which
//     a hidden tab has no frame to replace. Brief 04 ended the pass with a flush
//     (mmulti_vnet_flush()); since brief 04b every tab flushes each input as it makes it
//     (SendInputNow() in game.c) and the master flushes each tic it forwards, so the pass needs
//     none (the four hidden scenarios pass without it: 04b-lag-cuts.md, Outcome).
// A hidden single player game does not get here: it pauses in the yield, as in brief 02.
void HiddenNetPass(void)
{
    int n;

    for (n = 0; n < 8 && ready2send && totalclock >= ototalclock + TICSPERFRAME; n++)
        faketimerhandler();
    checksync();
}
