#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-or-later
#
# Finds every place where the game draws two or more random numbers in one full expression, where the C standard
# leaves the order of evaluation open (bugs.md D15, doco/browser/F-D15-krand-order.md).
#
#   tests/tools/krand-order.py              # scans src/*.c with clang's AST; prints the sites; exit 1 if there are any
#   tests/tools/krand-order.py FILE.c ...   # only these files
#
# A random call is a call of krand() (which TRAND and rnd() expand to) or of a function that calls it, directly or not
# (spawn(), EGS()'s callers, ...). A combination of two such calls is a bug when the standard does not sequence them:
#   * two arguments of one call, or an argument and the called function's own expression,
#   * the two operands of a binary operator other than && || and the comma, and of an assignment (also compound),
#   * two operands of an array subscript, two elements of an initialiser list.
# Not a bug: the condition of ?: against its branches, && || and , (sequenced), separate statements, separate
# declarators of one declaration (each is a full expression), and a call that runs after its arguments are all
# evaluated (f(TRAND) with f drawing numbers itself is fine: the argument is evaluated first).
# The cure is to draw each number into a local, in the order you mean, in statements of their own (code-facts.md 19).
#
# Needs clang (the AST comes from `clang -Xclang -ast-dump=json`), python3 and the SDL2 headers (sdl2-config); about 15 seconds
# for all of src/ (part of `make test`). Without clang it prints NOT RUN and exits 3. A single FILE.c is scanned alone: the functions
# that call krand() through others are only known from the files given, so scan all of src/ for a verdict.
import glob, json, os, shutil, subprocess, sys, threading

sys.setrecursionlimit(200000)
threading.stack_size(512 * 1024 * 1024)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SEQUENCED_OPS = {'&&', '||', ','}


def flags():
    f = ['-fsyntax-only', '-w', '-std=c99', '-Isrc', '-Ijfbuild/include', '-Ijfmact', '-Ijfaudiolib/include',
         '-DRENDERTYPESDL=1', '-DUSE_POLYMOST=1', '-DUSE_OPENGL=1', '-DDATADIR="/x"']
    for cmd in ('sdl2-config --cflags', 'pkg-config --cflags gtk+-3.0'):
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        if r.returncode == 0:
            f += r.stdout.split()
    return f


class Scan:
    def __init__(self):
        self.st = {'file': None, 'line': 0}
        self.funcs = {}      # function name -> names it calls
        self.cands = []      # (file, line, function, [sets of callee names, one per operand that has calls])

    def loc(self, l):
        # clang prints a location's file and line only when they changed since the last one printed
        if not isinstance(l, dict):
            return None
        if 'spellingLoc' in l or 'expansionLoc' in l:
            self.loc(l.get('spellingLoc'))
            return self.loc(l.get('expansionLoc'))
        if 'file' in l:
            self.st['file'] = l['file']
        if 'line' in l:
            self.st['line'] = l['line']
        return (self.st['file'], self.st['line'])

    @staticmethod
    def callee(n):
        def find(x):
            if x.get('kind') == 'DeclRefExpr':
                r = x.get('referencedDecl', {})
                return r.get('name') if r.get('kind') == 'FunctionDecl' else '<ptr>'
            for c in x.get('inner', []):
                r = find(c)
                if r:
                    return r
            return None
        inn = n.get('inner', [])
        return (find(inn[0]) if inn else None) or '<indirect>'

    def walk(self, n, fname):
        k = n.get('kind')
        l0 = self.loc(n['loc']) if 'loc' in n else None
        b = None
        if n.get('range'):
            b = self.loc(n['range'].get('begin'))
            self.loc(n['range'].get('end'))
        pos = b or l0 or (None, self.st['line'])
        isdef = k == 'FunctionDecl' and any(c.get('kind') == 'CompoundStmt' for c in n.get('inner', []))
        if isdef:
            fname = n.get('name')
        kids = [self.walk(c, fname) for c in n.get('inner', [])]
        s = set()
        for x in kids:
            s |= x
        if k == 'CallExpr':
            s.add(self.callee(n))
        if isdef:
            self.funcs.setdefault(fname, set()).update(s)
        comb = k in ('CallExpr', 'InitListExpr', 'ArraySubscriptExpr') or \
            (k in ('BinaryOperator', 'CompoundAssignOperator') and n.get('opcode') not in SEQUENCED_OPS)
        if comb and fname and sum(1 for x in kids if x) >= 2:
            self.cands.append((pos[0], pos[1], fname, [x for x in kids if x]))
        return s


def scan_file(path, fl):
    p = subprocess.run(['clang', '-Xclang', '-ast-dump=json'] + fl + [path], cwd=ROOT, capture_output=True)
    if p.returncode != 0:
        return None
    out = {}

    def main():
        s = Scan()
        d = json.loads(p.stdout)
        for top in d.get('inner', []):
            s.walk(top, None)
        out['s'] = s
    t = threading.Thread(target=main)
    t.start()
    t.join()
    return out['s']


def main():
    if not shutil.which('clang'):
        print('krand-order: NOT RUN: clang not found')
        return 3
    files = sys.argv[1:] or sorted(glob.glob(os.path.join(ROOT, 'src', '*.c')))
    files = [os.path.relpath(os.path.abspath(f), ROOT) for f in files]
    fl = flags()
    funcs, cands, skipped = {}, [], []
    for f in files:
        s = scan_file(f, fl)
        if s is None:
            skipped.append(f)      # e.g. the Windows-only files
            continue
        for k, v in s.funcs.items():
            funcs.setdefault(k, set()).update(v)
        cands += s.cands
    rand = {'krand'}
    grew = True
    while grew:
        grew = False
        for k, v in funcs.items():
            if k not in rand and v & rand:
                rand.add(k)
                grew = True
    sites = set()
    for file, line, fname, kids in cands:
        if sum(1 for k in kids if k & rand) >= 2:
            sites.add((file, line, fname))
    for file, line, fname in sorted(sites):
        print('%s:%d: %s(): two or more random numbers drawn in one expression, in no fixed order' % (file, line, fname))
    print('krand-order: %d site(s) in %d file(s)%s' % (len(sites), len(files) - len(skipped), (' (not compiled here: %s)' % ', '.join(skipped)) if skipped else ''))
    return 1 if sites else 0


if __name__ == '__main__':
    sys.exit(main())
