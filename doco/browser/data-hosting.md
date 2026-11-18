# Hosting the game data

The browser build does not contain the game. The page (`web/data.js`) downloads one file, the Duke Nukem 3D shareware data, from a URL you choose, checks it, and keeps it in the visitor's browser. This page says what to put on the server. It is [jfSW's `data-hosting.md`](https://github.com/VenKamikaze/jfsw-browser/blob/claude/doco/browser/data-hosting.md) with Duke's file, sizes and checksums, **limited to what exists in this repository after brief 03**: the whole deployment (the page, Apache with TLS, the relay, desktop players) is brief 06's.

Only the **shareware** GRP may be offered for public download by default (decision D11). Someone who owns the registered game can pick their own `duke3d.grp` in the page ("Use your own copy of the game data..."); it stays on their machine.

**The shareware licence and network games (decision D14).** With the shareware data the game refuses network games unless they are allowed, because the shareware licence's clause [3][D] does not let anyone offer an online multiplayer service with it (`00-setup.md`, Outcome, "Licence"). `config.js` has a switch, `allowSharewareNetGames`, **false** by default; see below. A site that serves the shareware GRP to the public must leave it false.

## What to serve

One file: the extracted shareware GRP, **11,035,779 bytes, CRC-32 `983AD923`** ("Shareware Version", 1.3D), named anything you like (`duke3dshare.grp` below).

`scripts/fetch-test-data.sh` produces a verified copy as `testdata/duke3dshare.grp`. It downloads the shareware archive `3dduke13.zip` from a public mirror, takes `DUKE3D.GRP` out of it and checks the size and CRC-32. Copy that file to your server. Do not serve the zip: the page does not unpack it, and the public mirrors (`image.dosgamesarchive.com`, `archive.org`) send no CORS headers, so a page on another origin cannot read them anyway.

The page accepts any file whose size and CRC-32 are in the table of `src/grpscan.c` (copied in `web/grptable.js`; `tests/web/grptable.js` keeps them equal): the shareware GRP and the Mac shareware one, and the registered ones (1.3d, 1.4, 1.5, the 20th Anniversary release). NAM is in the table but is refused for now.

## Telling the page where it is: `config.js`

`config.js` sits next to `index.html`:

```js
window.JFSW_CONFIG = {
  testMode: false,
  relay: '',
  allowSharewareNetGames: false,
  data: { url: 'duke3dshare.grp', size: 11035779, crc32: '983ad923', revalidate: false }
};
```

- `data.url`: relative to the page, or a full URL. The default is the page's own origin, which needs no CORS.
- `data.size`, `data.crc32`: what the file must be. Keep them: the progress bar needs `size` when the response is compressed, and a wrong or cut-off file is refused before anything is checked further. Use `0` and `''` to declare nothing.
- `data.revalidate`: see "Caching" below.
- `allowSharewareNetGames`: **leave `false` on a public site.** `true` makes the page start the game with `-allowsharewarenet`, which lets the shareware game take part in network games. Set it only for a LAN deployment: a private network of people who each have the right to play the shareware version (a party, a classroom). It is read from this file only; nothing in the page address can switch it on. Registered data (a file the player picks, or a GRP you host yourself) allows network games whatever this says. Network games themselves arrive with brief 04.
- `relay` is for brief 05 and is not used yet. `testMode` **must stay `false` on a public site**: with `true`, a link with `?test=1` could pass the game test arguments, and could put loose game files (among them a CON script that changes the simulation) in the game's folder.

`?data=<url>` on the page address overrides `data.url` (the declared `size` and `crc32` are then ignored; the file must still be a known GRP). **Outside test mode only a URL on the page's own origin is accepted** (it is resolved against the page address): any other `?data=` is ignored with a console warning, so a link cannot make a visitor's page load a game from another site. To use data on another origin, set `data.url` in `config.js`.

**CON scripts come from the GRP only.** The page never writes a loose `GAME.CON`, `DEFS.CON` or `USER.CON`, and the browser build of the game reads those three from the GRP even if a loose copy were there (`code-facts.md` §18): players with the same GRP play the same game. (Only test mode lifts this.)

`scripts/build-wasm.sh` copies `web/config.js` into `build-wasm/` whenever `web/config.js` is newer than that copy (after a `git pull` that changes it, for example), so an edit in `build-wasm/` can be lost. Keep your own `config.js` outside the build and deploy that one.

**Changing `data.url`, `data.size` or `data.crc32` makes every visitor download the file again on their next visit**, and the browser forgets its copy from the old URL.

## MIME type

`application/octet-stream`. The page reads the bytes with `fetch`, so the type is not checked, but this avoids a server guessing `text/plain` and compressing or rewriting it.

## Compression

The GRP compresses well. Measured on `duke3dshare.grp` (11,035,779 bytes; `gzip` 1.12 on the command line, Brotli through Node's zlib; times on a busy 4-core machine, so only the order matters):

| | bytes | of the original | time to compress |
|---|---|---|---|
| gzip -1 | 5,237,944 | 47.5 % | 0.2 s |
| gzip -6 (Apache's `mod_deflate` default) | 4,875,491 | 44.2 % | 0.5 s |
| gzip -9 | 4,842,497 | 43.9 % | 2.2 s |
| Brotli, quality 5 | 4,691,149 | 42.5 % | 0.9 s |
| Brotli, quality 9 | 4,616,369 | 41.8 % | 3.1 s |

So gzip saves about **56 %** of the transfer (6.2 MB of 11 MB); Brotli a little more. Either on the fly or pre-compressed works (pre-compress for Brotli above quality 5 and serve the `.br` or `.gz` with `Content-Encoding`). **If you turn on `revalidate`, check how your server treats the ETag of a compressed answer** (see the Apache example: by default `mod_deflate` changes it and every load downloads the file again).

What this does to the page's progress display: with `Content-Encoding`, `Content-Length` (if present) is the compressed size, while the browser hands the page the decompressed bytes. The page therefore takes the total from the declared `size` in `config.js`. If no size is declared and the response is encoded, it shows megabytes so far and an indeterminate bar rather than a wrong percentage. Both are tested (`tests/web/data.js`, test 6).

On a cross-origin server `Content-Encoding` is not readable by the page unless exposed; the page copes either way because it never needs it when `size` is declared.

## Caching

The page stores the file in the browser itself (IndexedDB, database `jfduke3d-data`), so the server's HTTP cache headers do not decide whether a returning visitor downloads again. The page asks `fetch` not to use the HTTP cache (`cache: 'no-store'`), so the browser does not keep a second 11 MB copy there. A returning visitor makes **no request for the file at all**, unless:

- `config.js`'s `url`, `size` or `crc32` changed, or
- the visitor presses "Download again", or
- `revalidate: true` is set in `config.js`. Then each load sends a conditional request (`If-None-Match` from the stored `ETag`, and `If-Modified-Since` from `Last-Modified`). A `304` answer costs a few hundred bytes and the stored copy is used; a `200` replaces it. If the server cannot be reached the stored copy is used.

The stored copy is checksummed again on every load (15 ms in Node and about 60 ms in headless Chromium, in a busy 4-core container, for the shareware GRP's 11 MB; a registered GRP is four times as long), so a copy damaged in the browser's storage is discarded and downloaded again.

If you do replace the file on the server and want visitors to get it, change the file's URL (e.g. `duke3dshare-v2.grp`) and `config.js`, or turn `revalidate` on. For a file that never changes there is nothing to do.

Still send good cache headers: they matter to anyone who fetches the URL otherwise (a proxy, `curl`). A long `max-age` with an `ETag` is right: `Cache-Control: public, max-age=31536000, immutable` if the URL is versioned, else `max-age=86400` and an `ETag`. Always send `ETag` (Apache does for static files) if you enable `revalidate`.

## CORS

Needed only when `url` is on a different origin from the page (different scheme, host or port). The server must send:

```
Access-Control-Allow-Origin: https://game.example.org      (or *)
```

and, if you set `revalidate: true`, also `Access-Control-Allow-Headers: If-None-Match, If-Modified-Since` (and answer the `OPTIONS` preflight those headers cause with a 204 carrying the same headers) and `Access-Control-Expose-Headers: ETag, Last-Modified` so the page can read the validators. Without `revalidate` no preflight happens.

A browser reports a blocked cross-origin request exactly like a network failure, so the page's error message says both and, when the URL is cross-origin, adds the CORS hint.

## Example: Apache

Placeholders only (`game.example.org`, `data.example.org`, `/srv/http/games/duke3d`). **These blocks are jfSW's, with the names changed.** jfSW checked them with a real Apache 2.4.58 (Ubuntu): `apache2 -t` said "Syntax OK", and `curl` showed gzip, an `ETag`, a `304` for a conditional request, and the CORS headers on both `GET` and the `OPTIONS` preflight. They were **not run again for Duke** (no Apache was installed or started in this work); nothing in them depends on the file but its name.

Modules: `mod_mime`, `mod_filter` (needed for `AddOutputFilterByType` in 2.4), `mod_deflate`, `mod_headers`, and `mod_rewrite` for the preflight (`a2enmod filter deflate headers rewrite`, or `LoadModule` lines on Arch).

```apache
<VirtualHost *:443>
    ServerName game.example.org
    DocumentRoot /srv/http/games/duke3d
    # index.html, config.js, jfduke3d.js, data.js, grptable.js, duke3d.js, duke3d.wasm, ... and duke3dshare.grp

    # Important when config.js has revalidate: true. mod_deflate rewrites the ETag of a compressed
    # answer to "...-gzip" by default, which no longer matches the ETag the page stored, so Apache
    # answers 200 and sends all 11 MB again on every load. NoChange (2.4.58 and later; the directive
    # is allowed here and in the server config, not in <Directory>) keeps the ETag as it is. The
    # caveat: the compressed and the plain answer now share one ETag. On an older Apache, leave
    # revalidate off, or do not compress the GRP (remove application/octet-stream below), or serve a
    # pre-compressed duke3dshare.grp.gz with "AddEncoding gzip .gz" and a rewrite to it.
    DeflateAlterETag NoChange

    <Directory /srv/http/games/duke3d>
        Require all granted
        AddType application/octet-stream .grp
        AddType application/wasm .wasm
        AddOutputFilterByType DEFLATE application/octet-stream application/wasm text/html text/css text/javascript application/javascript

        # The page keeps its own copy of the GRP, so this matters for other clients only.
        <FilesMatch "\.grp$">
            Header set Cache-Control "public, max-age=86400"
        </FilesMatch>
        # The page, its scripts and the wasm change with each deployment and must be of one build: always ask.
        <FilesMatch "\.(html|js|css|wasm)$">
            Header set Cache-Control "no-cache"
        </FilesMatch>
    </Directory>
</VirtualHost>
```

**If the GRP is on another host** (set `url` in `config.js` to `https://data.example.org/duke3dshare.grp`), give that host the same `AddType`, compression and `DeflateAlterETag` lines, and these CORS rules (the data host's vhost, not the game's):

```apache
<VirtualHost *:443>
    ServerName data.example.org
    DocumentRoot /srv/http/games/data

    <Location "/duke3dshare.grp">
        Header always set Access-Control-Allow-Origin "https://game.example.org"
        Header always set Access-Control-Expose-Headers "ETag, Last-Modified"
        # Only needed with revalidate: true (the conditional headers make the browser send a preflight):
        Header always set Access-Control-Allow-Headers "If-None-Match, If-Modified-Since"
        Header always set Access-Control-Max-Age "86400"
    </Location>
    # Answer the preflight (OPTIONS) with 204 and the headers above. <Location>, not <Files>:
    # the rewrite answers before the file is mapped, and <Files> would not apply.
    RewriteEngine On
    RewriteCond %{REQUEST_METHOD} OPTIONS
    RewriteRule ^/duke3dshare\.grp$ - [R=204,L]
</VirtualHost>
```

## Checking it

`curl -sI -H 'Accept-Encoding: gzip' https://game.example.org/duke3dshare.grp` should show `200`, `Content-Type: application/octet-stream`, `Content-Encoding: gzip` and an `ETag`. To check the file you uploaded, download it with `curl -s --compressed -o check.grp https://game.example.org/duke3dshare.grp` and run `python3 -c "import zlib,sys;print(hex(zlib.crc32(open(sys.argv[1],'rb').read())))" check.grp`: it must print `0x983ad923`, and the file must be 11,035,779 bytes.
