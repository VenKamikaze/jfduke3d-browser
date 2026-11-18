// Test-only hooks (see testhooks.h and doco/browser/01-native-relay.md). Used by the network tests,
// never by players. Nothing in here runs without its argument.

#include "duke3d.h"
#include "testhooks.h"
#include "netgame.h"

int TestSyncOn = 0;
int TestQuitTics = 0;
int TestNudgeTic = -1;

void TestSyncArg(void)         { TestSyncOn = 1; }
void TestQuitArg(int tics)     { TestQuitTics = tics; }
void TestNudgeArg(int tic)     { TestNudgeTic = tic; }

// Added to the version byte of packet 6: only -testsync changes what is on the wire, so only it
// needs every player to agree. (jfSW also adds the quit tic; there a mismatch is only a log line,
// here a mismatch ends the game with a message, and a different -testquit is harmless to the game.)
int TestVersionSalt(void)
{
    return TestSyncOn ? 8 : 0;
}

int TestSyncTic(int index)
{
    return TestSyncOn ? index + 1 : index * 8 + 7;
}

// ---- The simulation state, as a list of fields -------------------------------------------------
//
// WalkState() lists, in a fixed order, every field of the state that the hash covers, as (part, object,
// field name, value) to a callback. The hash and the text dump (-teststate) are both made from it, so
// what a dump shows is exactly what was hashed. Fields are listed one by one (never raw memory:
// padding and pointers differ between machines and builds). Six parts, so that a test that finds two
// machines disagreeing also finds which part of the state they disagree about:
//   players   ps[] of every connected player: all of the simulation's fields, but not the ones that
//             are a machine's own (palette pointer, gm, the on-screen message fta/ftq, zoom,
//             visibility, the flash colour pals, refresh_inventory), and not the
//             kill statistics actors_killed / max_actors_killed (actors.c credits every kill to
//             ps[myconnectindex], so they differ between machines: A1's list). The settings
//             each player announces (packet 6: aim_mode, auto_aim, weaponswitch, ud.wchoice and
//             the name) are in it: every machine must hold every player's (bugs.md D1, fixed)
//   sprites   every sprite in use (statnum < MAXSTATUS): every field (but yoffset of a player's
//             sprite, statnum 10: the drawing code writes it), and the order of the status lists
//             and the sector lists (the order the game moves things in)
//   hittype   hittype[] of every sprite in use: every field and temp_data (but not those of the ambient
//             sound sprites, see below) and not dispicnum, which animatesprites() in the drawing code
//             sets (to the picture last drawn): it is what a machine has drawn so far, and differs
//             between machines (it was the first difference seen, in the first tic of the first test)
//   sectors   sector[0 .. numsectors-1]: every field
//   walls     wall[0 .. numwalls-1]: every field
//   other     the rest of the state the simulation keeps from tic to tic: ud's game fields,
//             global_random, everyothertime, earthquaketime, the animation, cycler, animated wall
//             and sprite-queue tables, frags, the player start points po[], numplayers and the
//             player list.
// and randomseed, separately. What is left out is a machine's own and not the simulation's; each was
// found by running two machines and looking at the first tic at which they differed.

enum { PART_PLAYERS, PART_SPRITES, PART_HITTYPE, PART_SECTORS, PART_WALLS, PART_OTHER, NUMPARTS };
static const char *PartNames[NUMPARTS] = { "player", "sprite", "hittype", "sector", "wall", "other" };

typedef void (*emit_fn)(int part, int obj, const char *name, int value);

// where an animation's target int lives (the tables hold pointers): an offset into the array it
// points into, so that machines (and builds) can compare it
static int PtrOffset(const int *p)
{
    const char *c = (const char *)p;
    if (!p) return -1;
    if (c >= (const char *)sector && c < (const char *)&sector[MAXSECTORS])
        return (int)(c - (const char *)sector);
    if (c >= (const char *)wall && c < (const char *)&wall[MAXWALLS])
        return 0x1000000 + (int)(c - (const char *)wall);
    if (c >= (const char *)sprite && c < (const char *)&sprite[MAXSPRITES])
        return 0x2000000 + (int)(c - (const char *)sprite);
    return -2;
}

static void WalkState(emit_fn e)
{
    int i, j, k;
    char nm[24];
    struct player_struct *p;
    spritetype *s;
    struct weaponhit *t;
    sectortype *sc;
    walltype *w;

#define E(part, obj, name, v) e(part, obj, name, (int)(v))
#define P(f) E(PART_PLAYERS, i, #f, p->f)
    for (i = connecthead; i >= 0; i = connectpoint2[i]) {
        p = &ps[i];
        P(exitx); P(exity); P(numloogs); P(loogcnt);
        P(posx); P(posy); P(posz); P(horiz); P(ohoriz); P(ohorizoff); P(invdisptime);
        P(bobposx); P(bobposy); P(oposx); P(oposy); P(oposz); P(pyoff); P(opyoff);
        P(posxv); P(posyv); P(poszv); P(last_pissed_time); P(truefz); P(truecz);
        P(player_par); P(bobcounter); P(weapon_sway); P(randomflamex); P(crack_time); P(pals_time);
        // the settings each player announced (packet 6): bugs.md D1 had a slave file another slave's
        // under the master, so that in a game of three or more they differed between machines
        P(aim_mode); P(auto_aim); P(weaponswitch);
        for (k = 0; k < 10; k++) { sprintf(nm, "wchoice%d", k); E(PART_PLAYERS, i, nm, ud.wchoice[i][k]); }
        for (k = 0; k < (int)sizeof(ud.user_name[0]); k++) {
            sprintf(nm, "name%d", k); E(PART_PLAYERS, i, nm, ud.user_name[i][k]);
            if (!ud.user_name[i][k]) break;
        }
        P(ang); P(oang); P(angvel); P(cursectnum); P(look_ang); P(last_extra); P(subweapon);
        for (k = 0; k < MAX_WEAPONS; k++) { sprintf(nm, "ammo_amount%d", k); E(PART_PLAYERS, i, nm, p->ammo_amount[k]); }
        P(wackedbyactor); P(frag); P(fraggedself);
        P(curr_weapon); P(last_weapon); P(tipincs); P(horizoff); P(wantweaponfire);
        P(holoduke_amount); P(newowner); P(hurt_delay); P(hbomb_hold_delay);
        P(jumping_counter); P(airleft); P(knee_incs); P(access_incs);
        P(access_wallnum); P(access_spritenum);
        P(kickback_pic); P(got_access); P(weapon_ang); P(firstaid_amount);
        P(somethingonplayer); P(on_crane); P(i); P(one_parallax_sectnum);
        P(over_shoulder_on); P(random_club_frame); P(fist_incs);
        P(one_eighty_count); P(cheat_phase);
        P(dummyplayersprite); P(extra_extra8); P(quick_kick);
        P(heat_amount); P(actorsqu); P(timebeforeexit); P(customexitsound);
        for (k = 0; k < 16; k++) { sprintf(nm, "weaprecs%d", k); E(PART_PLAYERS, i, nm, p->weaprecs[k]); }
        P(weapreccnt); P(interface_toggle_flag);
        P(orotscrnang); P(rotscrnang); P(dead_flag); P(show_empty_weapon);
        P(scuba_amount); P(jetpack_amount); P(steroids_amount); P(shield_amount);
        P(holoduke_on); P(pycount); P(weapon_pos); P(frag_ps);
        P(transporter_hold); P(last_full_weapon); P(footprintshade); P(boot_amount);
        P(scream_voice);
        P(on_warping_sector); P(footprintcount);
        P(hbomb_on); P(jumping_toggle); P(rapid_fire_hold); P(on_ground);
        P(inven_icon); P(buttonpalette);
        P(jetpack_on); P(spritebridge); P(lastrandomspot);
        P(scuba_on); P(footprintpal); P(heat_on);
        P(holster_weapon); P(falling_counter);
        for (k = 0; k < MAX_WEAPONS; k++) { sprintf(nm, "gotweapon%d", k); E(PART_PLAYERS, i, nm, p->gotweapon[k]); }
        P(toggle_key_flag); P(knuckle_incs);
        P(walking_snd_toggle); P(palookup); P(hard_landing);
        P(return_to_center);
        P(max_secret_rooms); P(secret_rooms);
    }
#undef P

#define S(f) E(PART_SPRITES, i, #f, s->f)
    for (i = 0; i < MAXSPRITES; i++) {
        s = &sprite[i];
        if (s->statnum >= MAXSTATUS) continue;
        S(x); S(y); S(z); S(cstat); S(picnum); S(shade); S(pal); S(clipdist);
        S(xrepeat); S(yrepeat); S(xoffset);
        // animatesprites() (drawing, game.c) writes yoffset of a player's sprite while it is in the
        // air: not simulation state, and it differs between machines (the first difference seen)
        if (s->statnum != 10) S(yoffset);
        S(sectnum); S(statnum); S(ang); S(owner); S(xvel); S(yvel); S(zvel);
        S(lotag); S(hitag); S(extra);
    }
    // the order of the lists: the game moves things in list order
    for (k = 0; k < MAXSTATUS; k++) {
        if (headspritestat[k] < 0) continue;
        sprintf(nm, "statlist%d", k);
        for (j = headspritestat[k], i = 0; j >= 0; j = nextspritestat[j], i++) E(PART_SPRITES, k, nm, j);
    }
    for (k = 0; k < numsectors; k++) {
        if (headspritesect[k] < 0) continue;
        sprintf(nm, "sectlist%d", k);
        for (j = headspritesect[k]; j >= 0; j = nextspritesect[j]) E(PART_SPRITES, k, nm, j);
    }
#undef S

#define T(f) E(PART_HITTYPE, i, #f, t->f)
    for (i = 0; i < MAXSPRITES; i++) {
        if (sprite[i].statnum >= MAXSTATUS) continue;
        t = &hittype[i];
        T(cgg); T(picnum); T(ang); T(extra); T(owner); T(movflag); T(tempang);
        T(actorstayput); T(timetosleep); T(floorz); T(ceilingz); T(lastvx); T(lastvy);
        T(bposx); T(bposy); T(bposz);
        // not temp_data of the ambient sound sprites (statnum 11, MUSICANDSFX): movefx() keeps T1, T2
        // and T5 as audio bookkeeping from this machine's SoundToggle, AmbienceToggle, free voices and
        // the view point (ps[screenpeek]), so they are a machine's own (the second difference seen)
        if (!(sprite[i].statnum == 11 && sprite[i].picnum == MUSICANDSFX))
            for (k = 0; k < 6; k++) { sprintf(nm, "temp_data%d", k); E(PART_HITTYPE, i, nm, t->temp_data[k]); }
    }
#undef T

#define C(f) E(PART_SECTORS, i, #f, sc->f)
    E(PART_SECTORS, -1, "numsectors", numsectors);
    for (i = 0; i < numsectors; i++) {
        sc = &sector[i];
        C(wallptr); C(wallnum); C(ceilingz); C(floorz); C(ceilingstat); C(floorstat);
        C(ceilingpicnum); C(ceilingheinum); C(ceilingshade); C(ceilingpal); C(ceilingxpanning); C(ceilingypanning);
        C(floorpicnum); C(floorheinum); C(floorshade); C(floorpal); C(floorxpanning); C(floorypanning);
        C(visibility); C(lotag); C(hitag); C(extra);
    }
#undef C

#define W(f) E(PART_WALLS, i, #f, w->f)
    E(PART_WALLS, -1, "numwalls", numwalls);
    for (i = 0; i < numwalls; i++) {
        w = &wall[i];
        W(x); W(y); W(point2); W(nextwall); W(nextsector); W(cstat); W(picnum); W(overpicnum);
        W(shade); W(pal); W(xrepeat); W(yrepeat); W(xpanning); W(ypanning); W(lotag); W(hitag); W(extra);
    }
#undef W

#define O(f) E(PART_OTHER, 0, #f, f)
    O(numplayers); O(connecthead);
    for (i = 0; i < MAXPLAYERS; i++) { sprintf(nm, "connectpoint2_%d", i); E(PART_OTHER, 0, nm, connectpoint2[i]); }
    O(global_random); O(everyothertime); O(earthquaketime);
    E(PART_OTHER, 0, "ud.pause_on", ud.pause_on); E(PART_OTHER, 0, "ud.coop", ud.coop);
    E(PART_OTHER, 0, "ud.ffire", ud.ffire); E(PART_OTHER, 0, "ud.marker", ud.marker);
    E(PART_OTHER, 0, "ud.level_number", ud.level_number); E(PART_OTHER, 0, "ud.volume_number", ud.volume_number);
    E(PART_OTHER, 0, "ud.player_skill", ud.player_skill); E(PART_OTHER, 0, "ud.multimode", ud.multimode);
    E(PART_OTHER, 0, "ud.monsters_off", ud.monsters_off);
    E(PART_OTHER, 0, "ud.respawn_monsters", ud.respawn_monsters); E(PART_OTHER, 0, "ud.respawn_items", ud.respawn_items);
    E(PART_OTHER, 0, "ud.respawn_inventory", ud.respawn_inventory);
    E(PART_OTHER, 0, "ud.eog", ud.eog); E(PART_OTHER, 0, "ud.from_bonus", ud.from_bonus);
    E(PART_OTHER, 0, "ud.secretlevel", ud.secretlevel); E(PART_OTHER, 0, "ud.last_level", ud.last_level);
    O(animatecnt);
    for (i = 0; i < animatecnt; i++) {
        E(PART_OTHER, 1, "animateptr", PtrOffset(animateptr[i])); E(PART_OTHER, 1, "animategoal", animategoal[i]);
        E(PART_OTHER, 1, "animatevel", animatevel[i]); E(PART_OTHER, 1, "animatesect", animatesect[i]);
    }
    O(numcyclers);
    for (i = 0; i < numcyclers; i++)
        for (k = 0; k < 6; k++) { sprintf(nm, "cycler%d_%d", i, k); E(PART_OTHER, 0, nm, cyclers[i][k]); }
    O(numanimwalls);
    for (i = 0; i < numanimwalls; i++) {
        E(PART_OTHER, 2, "animwall.wallnum", animwall[i].wallnum); E(PART_OTHER, 2, "animwall.tag", animwall[i].tag);
    }
    O(spriteqloc); O(spriteqamount);
    for (i = 0; i < 1024; i++) E(PART_OTHER, 3, "spriteq", spriteq[i]);
    for (i = 0; i < MAXPLAYERS; i++)
        for (k = 0; k < MAXPLAYERS; k++) { sprintf(nm, "frags%d_%d", i, k); E(PART_OTHER, 0, nm, frags[i][k]); }
    for (i = 0; i < MAXPLAYERS; i++) {
        sprintf(nm, "po%d", i);
        E(PART_OTHER, 4, nm, po[i].ox); E(PART_OTHER, 4, nm, po[i].oy); E(PART_OTHER, 4, nm, po[i].oz);
        E(PART_OTHER, 4, nm, po[i].oa); E(PART_OTHER, 4, nm, po[i].os);
    }
#undef O
#undef E
}

// ---- The hashes: what -testdump and -testsync use -----------------------------------------------
//
// 32 bit FNV-1a over little endian 32 bit words.

#define FNV_STEP(h, v) ((h) = ((h) ^ ((unsigned int)(v) & 255)) * 16777619u)
static void fnv_int(unsigned int *h, int v)
{
    FNV_STEP(*h, v); FNV_STEP(*h, v >> 8); FNV_STEP(*h, v >> 16); FNV_STEP(*h, v >> 24);
}
#define HASH_INIT 2166136261u

static unsigned int PartHash[NUMPARTS];

static void HashEmit(int part, int obj, const char *name, int value)
{
    (void)name;
    fnv_int(&PartHash[part], obj);
    fnv_int(&PartHash[part], value);
}

struct testhashes {
    unsigned int tic, seed, part[NUMPARTS];     // eight words: the record of -testdump
};

static void TestHashAll(struct testhashes *t)
{
    int i;

    for (i = 0; i < NUMPARTS; i++) PartHash[i] = HASH_INIT;
    WalkState(HashEmit);
    t->seed = (unsigned int)randomseed;
    for (i = 0; i < NUMPARTS; i++) t->part[i] = PartHash[i];
}

unsigned char TestSyncByte(void)
{
    struct testhashes t;
    unsigned int h = HASH_INIT, v;
    int i;

    TestHashAll(&t);
    fnv_int(&h, (int)t.seed);
    for (i = 0; i < NUMPARTS; i++) fnv_int(&h, (int)t.part[i]);
    v = h ^ (h >> 8) ^ (h >> 16) ^ (h >> 24);
    return (unsigned char)(v & 255);
}

// ---- -teststate[<T>]: the state as text -----------------------------------------------------------
//
// With -testdump<name>, this machine also writes <name>.state, a field by field text dump of what the
// hashes cover, for finding which field two machines disagree about. One line per object:
//   t<T> <part> <object number> field=value field=value ...
// so a plain diff of two machines' files names the object, and the two lines name the field. It is
// written at the start of tics 1 and 2 and at the start of every tic T given (-teststate600
// -teststate1200: up to 16); -teststate alone gives the first two. Opt-in because it is big (a few
// hundred kilobytes a dump on E1L1).

static char TestDumpName[260];
static int TestStateOn, TestStateNum, TestStateTics[16];
static FILE *TestStateFile;
static int TestStateFailed;
static int stlast_part = -1, stlast_obj = -2;

static void TextEmit(int part, int obj, const char *name, int value)
{
    if (part != stlast_part || obj != stlast_obj) {
        if (stlast_part >= 0) fputc('\n', TestStateFile);
        fprintf(TestStateFile, "%s %d", PartNames[part], obj);
        stlast_part = part; stlast_obj = obj;
    }
    fprintf(TestStateFile, " %s=%d", name, value);
}

void TestStateArg(int tic)
{
    TestStateOn = 1;
    if (tic > 0 && TestStateNum < (int)(sizeof(TestStateTics) / sizeof(TestStateTics[0])))
        TestStateTics[TestStateNum++] = tic;
}

static void TestStateTic(int tic)
{
    int i;

    if (!TestStateOn || !TestDumpName[0] || TestStateFailed) return;
    for (i = 0; i < TestStateNum; i++)
        if (TestStateTics[i] == tic) break;
    if (tic > 2 && i == TestStateNum) return;
    if (!TestStateFile) {
        char name[280];
        snprintf(name, sizeof(name), "%s.state", TestDumpName);
        TestStateFile = fopen(name, "w");
        if (!TestStateFile) {
            TestStateFailed = 1;
            buildprintf("TEST: cannot write the state dump %s\n", name);
            return;
        }
    }
    fprintf(TestStateFile, "t%d randomseed=%d\n", tic, randomseed);
    stlast_part = -1; stlast_obj = -2;
    WalkState(TextEmit);
    if (stlast_part >= 0) fputc('\n', TestStateFile);
    fflush(TestStateFile);
}

// ---- -testdump<name> ---------------------------------------------------------------------------
//
// Every machine writes its own record of every game tic to <name> (in the game's working directory),
// so that a test can compare all machines byte for byte: the game's own sync check is one byte every
// 8 tics of a few positions, and only the machines' low bytes of them (code-facts section 2.5). One
// record of 32 bytes per game tic, eight little endian 32 bit words:
//   0  tic       the game tic about to be run, counted from 1 at the start of each level
//                (movefifoplc + 1; it starts again at 1 when a level starts)
//   1  seed      randomseed (the game's random number generator), before the tic
//   2  players   hash of ps[] of every connected player  } the state before the tic is moved:
//   3  sprites   hash of the sprites and their lists      } after the previous tic, and after
//   4  hittype   hash of hittype[] of the sprites in use  } the -testnudge of this tic.
//   5  sectors   hash of sector[]                         } What the hashes cover is above.
//   6  walls     hash of wall[]
//   7  other     hash of the remaining state of the simulation
// The file is flushed after every record so that a test can watch it grow (30 tics a second) while the
// game runs. Nothing goes on the wire and nothing in the game changes; without the argument none of
// this runs.

static FILE *TestDumpFile;
static int TestDumpFailed;

void TestDumpArg(const char *name)
{
    strncpy(TestDumpName, name, sizeof(TestDumpName) - 1);
    TestDumpName[sizeof(TestDumpName) - 1] = 0;
}

static void TestDumpTic(int tic)
{
    struct testhashes t;
    unsigned char rec[32];
    int i, k;

    if (!TestDumpName[0] || TestDumpFailed) return;
    if (!TestDumpFile) {
        TestDumpFile = fopen(TestDumpName, "wb");
        if (!TestDumpFile) {
            TestDumpFailed = 1;
            buildprintf("TEST: cannot write the tic dump %s\n", TestDumpName);
            return;
        }
        buildprintf("TEST: writing the tic dump %s (32 bytes a tic)\n", TestDumpName);
    }
    t.tic = (unsigned int)tic;
    TestHashAll(&t);
    for (i = 0; i < 8; i++)
        for (k = 0; k < 4; k++)
            rec[i * 4 + k] = (((unsigned int *)&t)[i] >> (8 * k)) & 255;
    fwrite(rec, 1, sizeof(rec), TestDumpFile);
    fflush(TestDumpFile);
}

// ---- The hooks in domovethings() ---------------------------------------------------------------

void TestTicHook(void)
{
    int tic = movefifoplc + 1;      // movefifoplc is advanced further on in domovethings()

    if (TestNudgeTic >= 0 && tic == TestNudgeTic) {
        buildprintf("TEST: nudging player %d at tic %d\n", myconnectindex, TestNudgeTic);
        ps[myconnectindex].posx += 8;
    }
    if (TestDumpName[0]) {
        TestStateTic(tic);
        TestDumpTic(tic);
    }
}

static void TestQuitFinish(void)
{
    unsigned int until;

    buildprintf("TEST: quitting after %d game tics: %d sync checks, %d mismatches, sync every %d tic%s, player %d of %d\n",
        movefifoplc, NetSyncChecks, NetSyncMismatches, TestSyncOn ? 1 : 8, TestSyncOn ? "" : "s",
        myconnectindex, numplayers);
    if (TestDumpFile) fflush(TestDumpFile);

    // a player that is a few tics behind still needs what we send: keep acknowledging and
    // resending for a moment before leaving
    if (numplayers > 1) {
        until = getticks() + 1500;
        while (getticks() < until) {
            handleevents();
            flushpackets();
        }
    }
    gameexit("");
}

void TestTicEnd(void)
{
    if (TestQuitTics > 0 && movefifoplc >= TestQuitTics)
        TestQuitFinish();
}
