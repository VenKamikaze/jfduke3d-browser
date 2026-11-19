// Test-only hooks (see testhooks.h and doco/browser/01-native-relay.md). Used by the network tests,
// never by players. Nothing in here runs without its argument.

#include "duke3d.h"
#include "testhooks.h"
#include "netgame.h"

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#endif

int TestSyncOn = 0;
int TestQuitTics = 0;
int TestNudgeTic = -1;
static int TestExitTic;         // -testexit<T>; 0 = off
static int TestFireOn, TestFireFrom;
static int TestArmOn;           // -testarm
static int TestLevelNo;         // the number of the level being played: 1 for the first, counted at its tic 1
static int TestCamTic, TestCamNum, TestMirrorTic, TestMirrorNum;     // -testcam<T>,<n>, -testmirror<T>,<n> (brief 04)
int TestNoDrawOn;               // -testnodraw (brief 04)

void TestSyncArg(void)         { TestSyncOn = 1; }
void TestQuitArg(int tics)     { TestQuitTics = tics; }
void TestNudgeArg(int tic)     { TestNudgeTic = tic; }

// Added to the version byte of packet 6: -testsync changes what is on the wire; -testexit, -testfire, -testarm,
// -testcam and -testmirror change the simulation (every player must have them, or the game desyncs), so players that
// differ are refused. (The byte is 134 on shareware data and the sum of all of them must stay under 122.)
// (jfSW also adds the quit tic; there a mismatch is only a log line, here a mismatch ends the game with a message,
// and a different -testquit is harmless to the game.)
int TestVersionSalt(void)
{
    return (TestSyncOn ? 8 : 0) + (TestExitTic > 0 ? 16 : 0) + (TestFireOn ? 32 : 0) + (TestArmOn ? 64 : 0) + (TestCamTic > 0 ? 1 : 0) + (TestMirrorTic > 0 ? 2 : 0);
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
//             visibility, the flash colour pals, refresh_inventory, orotscrnang: displayrooms() writes it
//             in OpenGL mode, scream_voice: the audio voice handle spritesound() returns, only ever
//             given to FX_StopSound(); code-facts.md section 17), and not the
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
        P(rotscrnang); P(dead_flag); P(show_empty_weapon);
        P(scuba_amount); P(jetpack_amount); P(steroids_amount); P(shield_amount);
        P(holoduke_on); P(pycount); P(weapon_pos); P(frag_ps);
        P(transporter_hold); P(last_full_weapon); P(footprintshade); P(boot_amount);
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
    fprintf(TestStateFile, "t%d randomseed=%d level=%d\n", tic, randomseed, TestLevelNo);
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

// ---- -testexit<T>, -teststall<T>,<ms>, -testfire[<N>] (A1: the level-exit test) ----------------------
//
// -testexit<T>: at game tic T of the first level every machine starts the countdown that a sector with
// lotag -2 starts (player.c's processinput: timebeforeexit 2 becomes 1 in this tic, and then every
// player's gm becomes MODE_EOL, the level number goes up: the writer at player.c:2516, which runs inside
// the tic on every machine, at the same tic). Only player connecthead is given the countdown (every
// player's would count the level up twice). The co-op bonus screen is skipped by the game itself
// (dobonus returns at once for co-op), so a headless game goes on into the next level. In the version
// byte (a machine without it would not leave the level).
//
// -teststall<T>,<ms>: at game tic T of the first level, after the exit if it is the same tic, this machine
// stops for <ms> ms with its clock running, then goes on with the tic. The other machines go on making
// their inputs meanwhile, so this one comes back with the inputs of more tics than the others in its
// fifo, and its own are made in a burst. It is how a machine gets tics' inputs in its fifo at the exit
// that the others never have (the tics moveloop() ran after MODE_EOL before the fix). In the browser it
// yields (ASYNCIFY) so that network events are taken in; natively a busy wait (the datagrams wait in
// the socket). Per machine: changes nothing in the simulation.
//
// -testfire[<N>]: from game tic N of the first level on (from its start without N) and in every later
// level, this machine's own inputs select the chaingun (weapon 4) and hold the fire key (and walk about): the ammo
// changes every few tics, and in co-op it is carried into the next level. The inputs go over the network as any
// other, and at tic 1 every machine gives every player the weapons, so it is in the version byte.

static int TestExitDone;
static int TestStallTic, TestStallMs, TestStallDone;

void TestExitArg(int tic)  { TestExitTic = tic; }
void TestFireArg(int tic)  { TestFireOn = 1; TestFireFrom = tic; }
void TestArmArg(void)      { TestArmOn = 1; }

void TestStallArg(const char *arg)
{
    const char *c = strchr(arg, ',');

    TestStallTic = atoi(arg);
    TestStallMs = c ? atoi(c + 1) : 1000;
}

static void TestStall(void)
{
#ifndef __EMSCRIPTEN__
    unsigned int t0;
#endif

    buildprintf("TEST: stalling for %d ms at tic %d\n", TestStallMs, movefifoplc + 1);
#ifdef __EMSCRIPTEN__
    emscripten_sleep(TestStallMs);
#else
    t0 = getticks();
    while ((int)(getticks() - t0) < TestStallMs)
        ;
#endif
    // the clock as a timer interrupt would have kept it: faketimerhandler() then makes the inputs that fell due
    sampletimer();
}

void TestInputHook(void)
{
    int n;

    // -testcam / -testmirror: the monitor's use key, the mirror's RPG (the input being made is for game tic movefifoend + 1)
    n = movefifoend[myconnectindex] + 1;
    if (TestLevelNo <= 1) {
        if (TestCamTic > 0 && n >= TestCamTic + 2 && n < TestCamTic + 6)
            loc.bits |= 1 << 29;
        if (TestMirrorTic > 0 && n >= TestMirrorTic + 60)
            loc.bits = (loc.bits & ~(15 << 8)) | (5 << 8) | (1 << 2);       // weapon 5 (the RPG), fire
    }
    if (!TestFireOn || (TestLevelNo <= 1 && movefifoend[myconnectindex] + 1 < TestFireFrom))
        return;
    loc.bits = (loc.bits & ~(15 << 8)) | (4 << 8) | (1 << 2);      // weapon 4 (the chaingun), fire
    // and move about, in a pattern of the input's number, so that an input of another level or another
    // moment is told from the right one by where the player goes
    n = movefifoend[myconnectindex];
    loc.fvel = (n & 7) * 120 + 200;
    loc.svel = ((n >> 2) & 1) ? 300 : -300;
    loc.avel = ((n >> 4) & 1) ? 6 : -4;
}

// The main loop found MODE_EOL: how many tics this machine played of the level, and how many more tics'
// inputs it had from every player by then (what moveloop() would run after the exit without the fix).
void TestLevelEnd(void)
{
    int i, more = MOVEFIFOSIZ;

    if (TestExitTic <= 0 && TestStallTic <= 0)
        return;
    for (i = connecthead; i >= 0; i = connectpoint2[i])
        if (movefifoend[i] - movefifoplc < more) more = movefifoend[i] - movefifoplc;
    buildprintf("TEST: left the level after tic %d, with the inputs of %d more tics here (sent up to tic %d)\n",
        movefifoplc, more, movefifosendplc);
}

// ---- -testpredict (A1): prediction must not change the simulation -------------------------------------
//
// fakedomovethings() (game.c) predicts the local player's moves from the inputs not yet confirmed. It is
// called from moveloop() and fakedomovethingscorrect() at any moment between tics, so it must leave every
// bit of the real simulation as it found it (it writes the my* copies and, temporarily, the cstat of the
// player's sprite). With -testpredict every call is checked: the raw bytes of every table the simulation
// keeps (ps[], sprite[], hittype[], sector[], wall[], ud, the sprite lists, the random seed, ...) are hashed
// just before and just after, and a difference is logged and counted. The raw bytes, not WalkState's
// fields: even what the state hash leaves out as a machine's own must not be written by the prediction.

static int TestPredictOn;
static int PredictChecked, PredictChanged;
static unsigned int PredictBefore[8];

void TestPredictArg(void) { TestPredictOn = 1; }

// -testmenu: report the menu state of a game, for the tests that press F4 and the like (bugs.md D3).
static int TestMenuOn;

void TestMenuArg(void) { TestMenuOn = 1; }

void TestMenuPoll(void)
{
    static int last = -2;
    int now;

    if (!TestMenuOn) return;
    now = (ps[myconnectindex].gm & MODE_MENU) ? current_menu : -1;
    if (now != last) {
        last = now;
        buildprintf("TEST: menu %d\n", now);
    }
}

static unsigned int RawHash(const void *p, size_t n)
{
    const unsigned char *b = (const unsigned char *)p;
    unsigned int h = HASH_INIT;
    size_t i;

    for (i = 0; i < n; i++) h = (h ^ b[i]) * 16777619u;
    return h;
}

static const char *PredictNames[8] = { "ps", "sprite", "hittype", "sector", "wall", "ud", "sprite lists", "scalars" };

static void PredictHashAll(unsigned int *h)
{
    int scalars[8], i;
    unsigned int lists = HASH_INIT, t;

    h[0] = RawHash(ps, sizeof(ps));
    h[1] = RawHash(sprite, sizeof(sprite));
    // not the entries of the ambient sound sprites: the audio callback (sounds.c testcallback(), run by the
    // audio thread when a sound ends) writes their temp_data[0] at any moment, which is not the prediction
    h[2] = HASH_INIT;
    for (i = 0; i < MAXSPRITES; i++)
        if (!(sprite[i].statnum == 11 && sprite[i].picnum == MUSICANDSFX))
            fnv_int(&h[2], (int)RawHash(&hittype[i], sizeof(hittype[i])));
    h[3] = RawHash(sector, sizeof(sector));
    h[4] = RawHash(wall, sizeof(wall));
    h[5] = RawHash(&ud, sizeof(ud));
#define L(a) do { t = RawHash(a, sizeof(a)); fnv_int(&lists, (int)t); } while (0)
    L(headspritesect); L(prevspritesect); L(nextspritesect);
    L(headspritestat); L(prevspritestat); L(nextspritestat);
    L(spriteq); L(frags); L(po);
#undef L
    h[6] = lists;
    scalars[0] = randomseed; scalars[1] = global_random; scalars[2] = numplayers;
    scalars[3] = movefifoplc; scalars[4] = numsectors; scalars[5] = numwalls;
    scalars[6] = spriteqloc; scalars[7] = animatecnt;
    h[7] = RawHash(scalars, sizeof(scalars));
}

void TestPredictBegin(void)
{
    if (TestPredictOn) PredictHashAll(PredictBefore);
}

void TestPredictEnd(void)
{
    unsigned int after[8];
    int i;
    char what[160] = "";

    if (!TestPredictOn) return;
    PredictHashAll(after);
    PredictChecked++;
    for (i = 0; i < 8; i++)
        if (after[i] != PredictBefore[i]) {
            strcat(what, what[0] ? ", " : "");
            strcat(what, PredictNames[i]);
        }
    if (what[0]) {
        PredictChanged++;
        if (PredictChanged <= 5)
            buildprintf("TEST: prediction %d (fakemovefifoplc %d, movefifoplc %d) changed the simulation: %s\n",
                PredictChecked, fakemovefifoplc, movefifoplc, what);
    }
}

// ---- -testdrawcheck, -testnodraw, -testcam, -testmirror (brief 04: the drawing-state audit) --------------
//
// Drawing must not leave anything behind that the simulation reads: a hidden browser tab draws nothing (brief 04's
// hidden pass), a visible one does, and both must play the same game. code-facts.md section 20 is the audit; these
// are its instruments. All test-only and inert without their argument.
//
// -testdrawcheck   compares the raw bytes of every table of the simulation (ps[], sprite[], hittype[], sector[], wall[],
//                  ud, the sprite lists) just before and just after displayrooms() and again around displayrest() (game.c):
//                  whatever drawing writes that lasts is logged once per field ("TEST: draw check: ...") and counted
//                  (the line -testquit prints). The ambient sound sprites' hittype is left out (the audio thread writes
//                  it at any moment, as for -testpredict).
// -testnodraw      this machine plays as a hidden browser tab does: no picture, the inputs made and the moves run by
//                  HiddenNetPass() (netgame.c); natively it spins. In a network game only.
// -testcam<T>,<n>  at game tic T of the first level every machine puts every player in front of the n-th security
//                  monitor (VIEWSCREEN) of the level, facing it, and from tic T+2 for four tics every player's own
//                  input presses the use key: the monitor switches to its camera, which is what makes the drawing code
//                  run animatecamsprite() (sector.c) on a machine that draws. Idle afterwards.
// -testmirror<T>,<n>  the same in front of the n-th mirror (mirrorwall[n]), facing it, and from tic T+60 on every player's
//                  own input fires the RPG (the only weapon that breaks a mirror, sector.c checkhitwall()).
// Both change the simulation (every player must be given them: the version byte), at the same tic on every machine.

static int TestDrawCheckOn;
static unsigned char *DcSnap[8];
static size_t DcSize[8];
static const char *DcNames[8] = { "ps", "sprite", "hittype", "sector", "wall", "ud", "lists", "scalars" };
static int DcFrames, DcChangedFrames, DcFields;
struct dcfield { int table, offset; int count; int first_index; unsigned char before[4], after[4]; const char *where; int level, tic; };
static struct dcfield DcSeen[400];

void TestDrawCheckArg(void) { TestDrawCheckOn = 1; }
void TestNoDrawArg(void) { TestNoDrawOn = 1; }
void TestCamArg(const char *arg)
{
    TestCamTic = atoi(arg);
    if (strchr(arg, ',')) TestCamNum = atoi(strchr(arg, ',') + 1);
}
void TestMirrorArg(const char *arg)
{
    TestMirrorTic = atoi(arg);
    if (strchr(arg, ',')) TestMirrorNum = atoi(strchr(arg, ',') + 1);
}

// the lists and scalars, packed into one buffer so that they compare like the tables
static size_t DcPack(unsigned char *out)
{
    size_t n = 0;
    int sc[8];
#define CP(a) do { if (out) memcpy(out + n, a, sizeof(a)); n += sizeof(a); } while (0)
    CP(headspritesect); CP(prevspritesect); CP(nextspritesect);
    CP(headspritestat); CP(prevspritestat); CP(nextspritestat);
    CP(spriteq); CP(frags); CP(po);
#undef CP
    sc[0] = randomseed; sc[1] = global_random; sc[2] = numplayers; sc[3] = movefifoplc;
    sc[4] = numsectors; sc[5] = numwalls; sc[6] = spriteqloc; sc[7] = animatecnt;
    if (out) memcpy(out + n, sc, sizeof(sc));
    n += sizeof(sc);
    return n;
}

static void DcTake(void)
{
    static size_t listsize;
    int i;

    if (!DcSnap[0]) {
        DcSize[0] = sizeof(ps); DcSize[1] = sizeof(sprite); DcSize[2] = sizeof(hittype);
        DcSize[3] = sizeof(sector); DcSize[4] = sizeof(wall); DcSize[5] = sizeof(ud);
        listsize = DcPack(NULL);
        DcSize[6] = listsize;
        DcSize[7] = 0;
        for (i = 0; i < 7; i++) DcSnap[i] = (unsigned char *)malloc(DcSize[i]);
    }
    memcpy(DcSnap[0], ps, sizeof(ps));
    memcpy(DcSnap[1], sprite, sizeof(sprite));
    memcpy(DcSnap[2], hittype, sizeof(hittype));
    memcpy(DcSnap[3], sector, sizeof(sector));
    memcpy(DcSnap[4], wall, sizeof(wall));
    memcpy(DcSnap[5], &ud, sizeof(ud));
    DcPack(DcSnap[6]);
}

void TestDrawBegin(void)
{
    if (TestDrawCheckOn) DcTake();
}

void TestDrawEnd(const char *where)
{
    const void *now[7];
    size_t unit[7];
    int t, i, changed = 0;
    unsigned char *lists;

    if (!TestDrawCheckOn || !DcSnap[0]) return;
    lists = (unsigned char *)malloc(DcSize[6]);
    DcPack(lists);
    now[0] = ps; now[1] = sprite; now[2] = hittype; now[3] = sector; now[4] = wall; now[5] = &ud; now[6] = lists;
    unit[0] = sizeof(ps[0]); unit[1] = sizeof(sprite[0]); unit[2] = sizeof(hittype[0]); unit[3] = sizeof(sector[0]);
    unit[4] = sizeof(wall[0]); unit[5] = sizeof(ud); unit[6] = DcSize[6];
    DcFrames++;
    for (t = 0; t < 7; t++) {
        const unsigned char *a = DcSnap[t], *b = (const unsigned char *)now[t];
        size_t n = DcSize[t], k;
        if (t == 3) n = numsectors * sizeof(sector[0]);
        if (t == 4) n = numwalls * sizeof(wall[0]);
        if (!memcmp(a, b, n)) continue;
        for (k = 0; k < n; k++) {
            int idx, off, f;
            if (a[k] == b[k]) continue;
            idx = (int)(k / unit[t]); off = (int)(k % unit[t]);
            // not the ambient sound sprites' hittype (the audio thread writes it)
            if (t == 2 && sprite[idx].statnum == 11 && sprite[idx].picnum == MUSICANDSFX) continue;
            // a field is a run of changed bytes in one object, 4 bytes wide at most: count it once
            off &= ~3;
            for (f = 0; f < DcFields; f++)
                if (DcSeen[f].table == t && DcSeen[f].offset == off && !strcmp(DcSeen[f].where, where)) break;
            if (f == DcFields) {
                if (DcFields >= (int)(sizeof(DcSeen) / sizeof(DcSeen[0]))) continue;
                memset(&DcSeen[f], 0, sizeof(DcSeen[f]));
                DcSeen[f].table = t; DcSeen[f].offset = off; DcSeen[f].where = where; DcSeen[f].first_index = idx;
                DcSeen[f].level = ud.level_number; DcSeen[f].tic = movefifoplc;
                for (i = 0; i < 4 && (size_t)off + i < unit[t]; i++) {
                    DcSeen[f].before[i] = a[idx * unit[t] + off + i]; DcSeen[f].after[i] = b[idx * unit[t] + off + i];
                }
                DcFields++;
                buildprintf("TEST: draw check: %s writes %s[%d] at byte %d: %02x%02x%02x%02x -> %02x%02x%02x%02x (tic %d)\n", where, DcNames[t], idx, off,
                    DcSeen[f].before[0], DcSeen[f].before[1], DcSeen[f].before[2], DcSeen[f].before[3],
                    DcSeen[f].after[0], DcSeen[f].after[1], DcSeen[f].after[2], DcSeen[f].after[3], movefifoplc);
            }
            DcSeen[f].count++;
            changed = 1;
            // the rest of this field's bytes
            k = (k | 3);
            if (k >= n) break;
        }
    }
    if (changed) DcChangedFrames++;
    free(lists);
}

// Where the n-th target is, from the level's own tables, and where to stand and look: ang is the way the player faces.
// A security monitor is a wall sprite: it faces along its angle, and the player stands in front of it. A mirror is a wall
// (mirrorwall[n]) of a thin sector between the room and the hidden sector that holds the reflection (mirrorsector[n]):
// the player stands in the room, on the side of the wall that is not the reflection's.
static int TestFindMonitor(int n, int *x, int *y, short *sect, short *ang)
{
    int i, k = 0, d, nx, ny, px, py, pass, sgn;
    static const int dists[4] = { 512, 768, 384, 1024 };
    short sc, a;

    for (i = headspritestat[6]; i >= 0; i = nextspritestat[i])
        if (sprite[i].picnum == VIEWSCREEN || sprite[i].picnum == VIEWSCREEN2)
            if (k++ == n) break;
    if (i < 0) return -1;
    // in front of the screen (along its angle), in its own sector if possible, else in any
    for (pass = 0; pass < 2; pass++)
        for (sgn = 0; sgn < 2; sgn++) {
            a = (sprite[i].ang + (sgn ? 1024 : 0)) & 2047;
            nx = sintable[(a + 512) & 2047]; ny = sintable[a & 2047];
            for (d = 0; d < 4; d++) {
                px = sprite[i].x + mulscale14(nx, dists[d]); py = sprite[i].y + mulscale14(ny, dists[d]);
                sc = sprite[i].sectnum;
                updatesector(px, py, &sc);
                if (sc >= 0 && (pass == 1 || sc == sprite[i].sectnum)) {
                    *x = px; *y = py; *sect = sc; *ang = (a + 1024) & 2047;
                    return i;
                }
            }
        }
    return -2;
}

static int TestFindMirror(int n, int *x, int *y, short *sect, short *ang)
{
    int w, sgn, d, px, py, mx, my, dx, dy;
    static const int dists[7] = { 1024, 768, 512, 1536, 384, 256, 192 };
    short sc, a, ws;

    if (n < 0 || n >= mirrorcnt) return -1;
    w = mirrorwall[n];
    // the wall's own sector: the one whose wall range holds it
    for (ws = 0; ws < numsectors; ws++)
        if (w >= sector[ws].wallptr && w < sector[ws].wallptr + sector[ws].wallnum) break;
    if (ws >= numsectors) return -1;
    dx = wall[wall[w].point2].x - wall[w].x; dy = wall[wall[w].point2].y - wall[w].y;
    mx = wall[w].x + dx / 2; my = wall[w].y + dy / 2;
    a = getangle(dx, dy);
    for (sgn = 0; sgn < 2; sgn++) {
        short na = (a + (sgn ? 512 : 1536)) & 2047;       // the two normals
        for (d = 0; d < 7; d++) {
            px = mx + mulscale14(sintable[(na + 512) & 2047], dists[d]); py = my + mulscale14(sintable[na & 2047], dists[d]);
            sc = ws;
            updatesector(px, py, &sc);
            if (sc >= 0 && sc != mirrorsector[n]) { *x = px; *y = py; *sect = sc; *ang = (na + 1024) & 2047; return w; }
        }
    }
    return -2;
}

static void TestGoPlace(int kind, int n)
{
    int i, x = 0, y = 0, cz, fz, target;
    short sect = 0, ang = 0;

    target = kind == 0 ? TestFindMonitor(n, &x, &y, &sect, &ang) : TestFindMirror(n, &x, &y, &sect, &ang);
    if (target < 0) {
        buildprintf("TEST: go: there is no %s %d to stand in front of (%d)\n", kind == 0 ? "monitor" : "mirror", n, target);
        return;
    }
    for (i = connecthead; i >= 0; i = connectpoint2[i]) {
        struct player_struct *p = &ps[i];
        getzsofslope(sect, x, y, &cz, &fz);
        p->posx = p->oposx = p->bobposx = x; p->posy = p->oposy = p->bobposy = y;
        p->posz = p->oposz = fz - PHEIGHT;
        p->truefz = fz; p->truecz = cz;
        p->posxv = p->posyv = p->poszv = 0;
        p->ang = p->oang = ang; p->horiz = p->ohoriz = 100; p->look_ang = 0;
        p->cursectnum = sect;
        sprite[p->i].x = x; sprite[p->i].y = y; sprite[p->i].z = p->posz + PHEIGHT;
        sprite[p->i].ang = ang;
        changespritesect(p->i, sect);
        hittype[p->i].floorz = fz; hittype[p->i].ceilingz = cz;
        p->on_ground = 1; p->jumping_counter = 0;
        if (kind == 1) {        // the RPG, with its ammunition (a game started with -v1 -l1 gives co-op players none)
            p->gotweapon[RPG_WEAPON] = 1;
            p->ammo_amount[RPG_WEAPON] = max_ammo_amount[RPG_WEAPON];
        }
        // (each machine sets the same, at the same tic: the simulation's next tic starts from here)
    }
    buildprintf("TEST: go: players placed at %d,%d in sector %d facing %d, %s %d (%s %d at %d,%d)\n", x, y, sect, ang,
        kind == 0 ? "monitor" : "mirror wall", target, kind == 0 ? "sprite" : "n", n,
        kind == 0 ? sprite[target].x : wall[target].x, kind == 0 ? sprite[target].y : wall[target].y);
}

// Called from domovethings() at every tic: the placement, and (tic T+12) what came of it.
static void TestGoTic(int tic)
{
    int i, k;

    if (TestLevelNo > 1) return;
    if (TestCamTic > 0 && tic == TestCamTic) TestGoPlace(0, TestCamNum);
    if (TestMirrorTic > 0 && tic == TestMirrorTic) TestGoPlace(1, TestMirrorNum);
    if (TestCamTic > 0 && tic == TestCamTic + 12) {
        for (i = headspritestat[6], k = 0; i >= 0; i = nextspritestat[i])
            if (sprite[i].picnum == VIEWSCREEN || sprite[i].picnum == VIEWSCREEN2) {
                if (k++ == TestCamNum) {
                    buildprintf("TEST: go: monitor sprite %d: yvel %d (1 = switched to its camera), camsprite %d, T1 %d\n", i, sprite[i].yvel, camsprite, hittype[i].temp_data[0]);
                    break;
                }
            }
    }
    if (TestMirrorTic > 0 && tic == TestMirrorTic + 260 && TestMirrorNum >= 0 && TestMirrorNum < mirrorcnt)
        buildprintf("TEST: go: mirror wall %d: overpicnum %d (%d = intact), picnum %d\n", mirrorwall[TestMirrorNum], wall[mirrorwall[TestMirrorNum]].overpicnum, MIRROR, wall[mirrorwall[TestMirrorNum]].picnum);
}

// ---- The hooks in domovethings() ---------------------------------------------------------------

void TestTicHook(void)
{
    int tic = movefifoplc + 1;      // movefifoplc is advanced further on in domovethings()

    if (tic == 1) TestLevelNo++;
    if (tic == 1 && TestLevelNo == 1 && (TestSyncOn || TestDumpName[0]))
        buildprintf("TEST: SoundToggle %d, AmbienceToggle %d\n", SoundToggle, AmbienceToggle);

    // a game started with -v1 -l1 gives co-op players no weapons (newgame() only does for a deathmatch;
    // a game started from the menu resets them with the new-game packet): give them the starting ones,
    // so that -testfire has ammo to spend (every machine does it at the same point of the simulation)
    if (TestFireOn && tic == 1 && TestLevelNo <= 1) {
        int i;
        for (i = connecthead; i >= 0; i = connectpoint2[i]) {
            resetweapons(i);
            ps[i].gotweapon[CHAINGUN_WEAPON] = 1;
            ps[i].ammo_amount[CHAINGUN_WEAPON] = 300;
        }
    }

    // -testarm: a scripted player with every weapon, full ammunition and health, so that a recorded demo goes on
    // through every kind of shooting and explosion (the demos of D15's tests). Plain simulation state set in the
    // same tic on every machine and in a demo's playback, as long as the argument is given to both.
    if (TestArmOn) {
        int i, w;
        for (i = connecthead; i >= 0; i = connectpoint2[i]) {
            if (tic == 1)
                for (w = PISTOL_WEAPON; w < MAX_WEAPONS; w++) ps[i].gotweapon[w] = 1;
            for (w = PISTOL_WEAPON; w < MAX_WEAPONS; w++)
                if (ps[i].ammo_amount[w] < max_ammo_amount[w] / 2) ps[i].ammo_amount[w] = max_ammo_amount[w];
            sprite[ps[i].i].extra = max_player_health;
        }
    }

    if (TestExitTic > 0 && !TestExitDone && TestLevelNo <= 1 && tic == TestExitTic) {
        TestExitDone = 1;
        ps[connecthead].timebeforeexit = 2;
        buildprintf("TEST: ending the level at tic %d (level %d)\n", tic, ud.level_number);
    }
    if (TestStallTic > 0 && !TestStallDone && TestLevelNo <= 1 && tic == TestStallTic) {
        TestStallDone = 1;
        TestStall();
    }

    if (TestNudgeTic >= 0 && tic == TestNudgeTic) {
        buildprintf("TEST: nudging player %d at tic %d\n", myconnectindex, TestNudgeTic);
        ps[myconnectindex].posx += 8;
    }
    TestGoTic(tic);
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
    if (TestPredictOn)
        buildprintf("TEST: prediction: %d predicted moves checked, %d changed the simulation\n", PredictChecked, PredictChanged);
    if (TestDrawCheckOn)
        buildprintf("TEST: draw check: %d frames checked, %d of them changed the simulation's tables, %d fields in all\n", DcFrames, DcChangedFrames, DcFields);
    if (TestDumpFile) fflush(TestDumpFile);

    // a player that is a few tics behind still needs what we send: keep acknowledging and
    // resending for a moment before leaving, and (the master) send the slaves the tics it has played
    // and not yet forwarded (the last tic is played before it is forwarded when a slave is slow)
    if (numplayers > 1) {
        until = getticks() + 1500;
        while (getticks() < until) {
            handleevents();
            getpackets();
            if (networkmode == 0 && myconnectindex == connecthead) sendmasterpackets(movefifoplc);
            flushpackets();
        }
    }
    gameexit("");
}

void TestTicEnd(void)
{
    static int reported;

    // (a tic that ended the level: the same line on every machine, for the tests)
    if ((TestExitTic > 0 || TestStallTic > 0) && !reported && (ps[myconnectindex].gm & MODE_EOL)) {
        reported = 1;
        buildprintf("TEST: the level ended in tic %d, next level %d\n", movefifoplc, ud.level_number);
    }
    if (TestQuitTics > 0 && movefifoplc >= TestQuitTics)
        TestQuitFinish();
}
