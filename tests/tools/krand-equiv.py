#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-or-later
#
# Checks, by AST, that a change which draws random numbers into locals (F-D15, doco/browser/F-D15-krand-order.md)
# does not change what the game draws or how it uses the numbers.
#
#   tests/tools/krand-equiv.py OLD_TREE NEW_TREE [FILE.c ...]     # files of src/, default: the ones that draw numbers
#
# For every function, the sequence of "events" (full expressions that draw random numbers) of the old tree, evaluated in
# gcc's order (last argument first, right operand first; every krand() is numbered in the order it runs), must be identical
# to the new tree's: there every local named r0..r9 or rs0..rs9 is folded back into the expression that uses it, and the
# draws are numbered in the order of the statements. Identical means the same draws, in the same order, reaching the same
# arguments: the check does not need a demo to reach the code, so it covers every site. Exit status 1 when something differs.
# Needs clang and the SDL2 headers; about a minute per file and 1 GB of memory.
import json, re, shutil, subprocess, sys, threading
sys.setrecursionlimit(200000)
threading.stack_size(512 * 1024 * 1024)

RLOCAL = re.compile(r'^rs?\d$')
STMT = {'CompoundStmt', 'IfStmt', 'ForStmt', 'WhileStmt', 'DoStmt', 'SwitchStmt', 'CaseStmt', 'DefaultStmt', 'LabelStmt',
        'ReturnStmt', 'DeclStmt', 'NullStmt', 'BreakStmt', 'ContinueStmt', 'GotoStmt', 'AttributedStmt'}
TRANSPARENT = {'ImplicitCastExpr', 'ParenExpr'}


def is_krand(n):
    if n.get('kind') != 'CallExpr':
        return False
    c = n['inner'][0]
    while c.get('kind') in TRANSPARENT:
        c = c['inner'][0]
    return c.get('kind') == 'DeclRefExpr' and c.get('referencedDecl', {}).get('name') == 'krand'


class F:
    def __init__(self, reverse):
        self.reverse = reverse       # old code: gcc's order
        self.n = 0                   # draws so far in this function
        self.env = {}
        self.events = []

    # evaluation order of the children of an expression node
    def order(self, n):
        k = n.get('kind')
        inn = n.get('inner', [])
        if not self.reverse:
            return list(range(len(inn)))
        if k == 'CallExpr':
            return [0] + list(range(len(inn) - 1, 0, -1))      # the function, then the arguments last to first
        if k in ('BinaryOperator', 'CompoundAssignOperator') and n.get('opcode') not in ('&&', '||', ','):
            return list(range(len(inn) - 1, -1, -1))
        return list(range(len(inn)))

    def assign(self, n, idx):
        for i in self.order(n):
            c = n['inner'][i]
            self.assign(c, idx)
        if is_krand(n):
            idx[id(n)] = self.n
            self.n += 1

    def text(self, n, idx):
        k = n.get('kind')
        inn = n.get('inner', [])
        if k in TRANSPARENT:
            return self.text(inn[0], idx)
        if is_krand(n):
            return 'R%d' % idx[id(n)]
        if k == 'DeclRefExpr':
            nm = n.get('referencedDecl', {}).get('name')
            if RLOCAL.match(nm or '') and nm in self.env:
                return self.env[nm]
            return nm
        if k == 'IntegerLiteral':
            return n['value']
        if k == 'MemberExpr':
            return '(%s%s%s)' % (self.text(inn[0], idx), '->' if n.get('isArrow') else '.', n['name'])
        if k in ('BinaryOperator', 'CompoundAssignOperator'):
            return '(%s %s %s)' % (self.text(inn[0], idx), n['opcode'], self.text(inn[1], idx))
        if k == 'UnaryOperator':
            return '(%s%s)' % (n['opcode'], self.text(inn[0], idx))
        if k == 'CStyleCastExpr':
            return '((%s)%s)' % (n.get('type', {}).get('qualType'), self.text(inn[0], idx))
        if k == 'ArraySubscriptExpr':
            return '%s[%s]' % (self.text(inn[0], idx), self.text(inn[1], idx))
        if k == 'CallExpr':
            return '%s(%s)' % (self.text(inn[0], idx), ', '.join(self.text(c, idx) for c in inn[1:]))
        if k == 'ConditionalOperator':
            return '(%s ? %s : %s)' % tuple(self.text(c, idx) for c in inn)
        return '<%s:%s>' % (k, ','.join(self.text(c, idx) for c in inn))

    def has_draw(self, n):
        if n.get('kind') == 'DeclRefExpr' and RLOCAL.match(n.get('referencedDecl', {}).get('name') or '') and n['referencedDecl']['name'] in self.env:
            return True
        return is_krand(n) or any(self.has_draw(c) for c in n.get('inner', []))

    def expr_root(self, n):
        if not self.has_draw(n):
            return
        # a hoisted draw: rN = <expr>;
        if n.get('kind') == 'BinaryOperator' and n.get('opcode') == '=':
            l = n['inner'][0]
            while l.get('kind') in TRANSPARENT:
                l = l['inner'][0]
            nm = l.get('referencedDecl', {}).get('name') if l.get('kind') == 'DeclRefExpr' else None
            if nm and RLOCAL.match(nm):
                idx = {}
                self.assign(n['inner'][1], idx)
                self.env[nm] = self.text(n['inner'][1], idx)
                return
        idx = {}
        self.assign(n, idx)
        self.events.append(self.text(n, idx))

    def stmt(self, n):
        k = n.get('kind')
        if k == 'DeclStmt':
            for d in n.get('inner', []):
                for c in d.get('inner', []):
                    self.expr_root(c) if not isinstance(c, str) else None
            return
        if k in STMT:
            for c in n.get('inner', []):
                if c.get('kind') in STMT:
                    self.stmt(c)
                elif c.get('kind') and c.get('kind') != '<<<NULL>>>':
                    self.expr_root(c)
            return
        if k:
            self.expr_root(n)


def functions(path_or_json, reverse):
    out = {}

    def main():
        d = path_or_json
        for top in d.get('inner', []):
            if top.get('kind') == 'FunctionDecl':
                body = [c for c in top.get('inner', []) if c.get('kind') == 'CompoundStmt']
                if body:
                    f = F(reverse)
                    f.stmt(body[0])
                    out[top['name']] = f.events
    t = threading.Thread(target=main)
    t.start()
    t.join()
    return out


def ast(tree, name):
    fl = ['-fsyntax-only', '-w', '-std=c99', '-Isrc', '-Ijfbuild/include', '-Ijfmact', '-Ijfaudiolib/include',
          '-DRENDERTYPESDL=1', '-DUSE_POLYMOST=1', '-DUSE_OPENGL=1', '-DDATADIR="/x"']
    for cmd in ('sdl2-config --cflags', 'pkg-config --cflags gtk+-3.0'):
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        if r.returncode == 0:
            fl += r.stdout.split()
    p = subprocess.run(['clang', '-Xclang', '-ast-dump=json'] + fl + ['src/' + name], cwd=tree, capture_output=True)
    if p.returncode != 0:
        sys.exit('krand-equiv: clang failed on %s/src/%s' % (tree, name))
    return json.loads(p.stdout)


def main():
    if len(sys.argv) < 3 or not shutil.which('clang'):
        print(__doc__ if len(sys.argv) < 3 else 'krand-equiv: NOT RUN: clang not found')
        return 2 if len(sys.argv) < 3 else 3
    old_tree, new_tree = sys.argv[1], sys.argv[2]
    files = sys.argv[3:] or ['actors.c', 'sector.c', 'player.c', 'gamedef.c', 'game.c']
    bad = nev = nfunc = 0
    for name in files:
        old = functions(ast(old_tree, name), True)
        new = functions(ast(new_tree, name), False)
        for fn in sorted(set(old) | set(new)):
            a, b = old.get(fn, []), new.get(fn, [])
            if a:
                nfunc += 1
                nev += len(a)
            if a != b:
                bad += 1
                print('DIFFERENT: %s: %s(): %d events before, %d after' % (name, fn, len(a), len(b)))
                for i in range(max(len(a), len(b))):
                    x = a[i] if i < len(a) else None
                    y = b[i] if i < len(b) else None
                    if x != y:
                        print('  event %d\n    old: %s\n    new: %s' % (i, x, y))
                        break
    print('krand-equiv: %d functions that draw random numbers, %d events, %d functions differ' % (nfunc, nev, bad))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
