# ------------------------------------------------------------
# Island Betrayal — character art generator (cel-shaded anime busts)
# كل الشخصيات بنفس الأسلوب: رأس أنمي، عيون كبيرة، ظل Cel، إضاءة حافة ملونة.
#   python3 scripts/gen_characters.py
# ------------------------------------------------------------
import math, os

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'characters')
CX = 300  # face center x
EY = 322  # eye line y

def shade(hexc, f):
    h = hexc.lstrip('#'); r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    if f < 1: r, g, b = r * f, g * f, b * f
    else: r, g, b = r + (255 - r) * (f - 1), g + (255 - g) * (f - 1), b + (255 - b) * (f - 1)
    return '#%02x%02x%02x' % (int(max(0, min(255, r))), int(max(0, min(255, g))), int(max(0, min(255, b))))

# ---------------- face shapes ----------------
def face_path(kind):
    if kind == 'round':
        return "M188 292 C188 196 412 196 412 292 C412 360 398 404 366 432 C344 450 322 460 300 461 C278 460 256 450 234 432 C202 404 188 360 188 292 Z"
    if kind == 'soft':  # female
        return "M212 292 C212 206 388 206 388 292 C388 342 376 378 352 406 C334 426 316 437 300 439 C284 437 266 426 248 406 C224 378 212 342 212 292 Z"
    if kind == 'mature':
        return "M203 292 C203 202 397 202 397 292 C397 348 388 386 364 414 C344 436 322 448 300 450 C278 448 256 436 236 414 C212 386 203 348 203 292 Z"
    return "M205 292 C205 204 395 204 395 292 C395 344 384 380 360 408 C340 430 318 443 300 445 C282 443 260 430 240 408 C216 380 205 344 205 292 Z"

def body(kind):
    if kind == 'broad':
        return "M20 800 C30 610 150 530 250 505 L350 505 C450 530 570 610 580 800 Z"
    if kind == 'slim':
        return "M80 800 C92 640 180 560 266 520 L334 520 C420 560 508 640 520 800 Z"
    return "M55 800 C66 628 166 548 262 512 L338 512 C434 548 534 628 545 800 Z"

def neck(skin, kind):
    w = 44 if kind == 'broad' else 36
    return (f'<path d="M{CX-w} 398 L{CX-w+2} 522 Q{CX} 548 {CX+w-2} 522 L{CX+w} 398 Z" fill="{skin}"/>'
            f'<path d="M{CX-w} 420 Q{CX} 470 {CX+w} 420 L{CX+w} 470 Q{CX} 500 {CX-w} 470 Z" fill="{shade(skin, .78)}" opacity=".7"/>')

# ---------------- eyes ----------------
def eye(cx, side, kind, iris, lash, lashes_extra=False):
    # side: -1 (viewer-left eye) or +1 ; drawn for left then mirrored
    y = EY
    g = []
    if kind == 'happy':
        g.append(f'<path d="M{cx-24} {y+6} Q{cx} {y-14} {cx+24} {y+6}" fill="none" stroke="{lash}" stroke-width="6" stroke-linecap="round"/>')
        g.append(f'<path d="M{cx-14} {y+12} Q{cx} {y+16} {cx+14} {y+12}" fill="none" stroke="{lash}" stroke-width="2" opacity=".5" stroke-linecap="round"/>')
    else:
        if kind == 'sleepy':
            white = f"M{cx-27} {y+3} C{cx-15} {y-5} {cx+15} {y-6} {cx+27} {y} C{cx+20} {y+19} {cx-18} {y+21} {cx-27} {y+3} Z"
            lid = f"M{cx-29} {y+3} C{cx-15} {y-7} {cx+16} {y-8} {cx+29} {y-1}"
        elif kind == 'sharp':
            white = f"M{cx-27} {y+5} C{cx-16} {y-10} {cx+16} {y-15} {cx+28} {y-8} C{cx+20} {y+16} {cx-16} {y+19} {cx-27} {y+5} Z"
            lid = f"M{cx-29} {y+5} C{cx-16} {y-12} {cx+16} {y-17} {cx+31} {y-10}"
        else:
            white = f"M{cx-27} {y+3} C{cx-18} {y-15} {cx+18} {y-16} {cx+27} {y-3} C{cx+20} {y+19} {cx-18} {y+21} {cx-27} {y+3} Z"
            lid = f"M{cx-29} {y+3} C{cx-18} {y-17} {cx+19} {y-18} {cx+30} {y-5}"
        cid = f"ec{cx}"
        g.append(f'<clipPath id="{cid}"><path d="{white}"/></clipPath>')
        g.append(f'<path d="{white}" fill="#fbfbff"/>')
        g.append(f'<g clip-path="url(#{cid})">'
                 f'<ellipse cx="{cx}" cy="{y+5}" rx="14" ry="17" fill="url(#iris)"/>'
                 f'<ellipse cx="{cx}" cy="{y+6}" rx="6.5" ry="8.5" fill="#120a08"/>'
                 f'<rect x="{cx-30}" y="{y-20}" width="60" height="9" fill="{shade(lash, 1.0)}" opacity=".18"/>'
                 f'<circle cx="{cx-5}" cy="{y}" r="4.2" fill="#fff"/><circle cx="{cx+6}" cy="{y+11}" r="2" fill="#fff" opacity=".9"/></g>')
        g.append(f'<path d="{lid}" fill="none" stroke="{lash}" stroke-width="{6 if lashes_extra else 5}" stroke-linecap="round"/>')
        # outer lash flick
        g.append(f'<path d="M{cx-27} {y+3} l-9 -5" stroke="{lash}" stroke-width="{4 if lashes_extra else 3}" stroke-linecap="round"/>')
        g.append(f'<path d="M{cx-17} {y+19} Q{cx} {y+23} {cx+16} {y+16}" fill="none" stroke="{lash}" stroke-width="1.8" opacity=".55" stroke-linecap="round"/>')
    inner = ''.join(g)
    if side > 0:
        inner = f'<g transform="translate({2*cx} 0) scale(-1 1)">{inner.replace(f"ec{cx}", f"ecr{cx}")}</g>'
    return f'<g transform="translate({cx} {EY}) scale(1.14) translate({-cx} {-EY})">{inner}</g>'

def brows(kind, color, w=7):
    out = []
    for side, cx in ((-1, CX - 46), (1, CX + 46)):
        if kind == 'serious':
            d = f"M{cx-28} {EY-38} Q{cx} {EY-40} {cx+24} {EY-28}"
        elif kind == 'raised':
            d = f"M{cx-28} {EY-34} Q{cx-2} {EY-50} {cx+24} {EY-38}"
        elif kind == 'thick':
            d = f"M{cx-29} {EY-34} Q{cx} {EY-44} {cx+25} {EY-33}"
        else:
            d = f"M{cx-28} {EY-33} Q{cx} {EY-44} {cx+24} {EY-35}"
        p = f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{w}" stroke-linecap="round"/>'
        out.append(p if side < 0 else f'<g transform="translate({2*cx} 0) scale(-1 1)">{p}</g>')
    return ''.join(out)

def glasses(color='#2a2a2e'):
    s = ''
    for cx in (CX - 46, CX + 46):
        s += f'<rect x="{cx-33}" y="{EY-22}" width="66" height="48" rx="16" fill="rgba(200,230,255,.12)" stroke="{color}" stroke-width="4"/>'
        s += f'<path d="M{cx-22} {EY-14} l14 -4" stroke="#fff" stroke-width="3" opacity=".55" stroke-linecap="round"/>'
    s += f'<path d="M{CX-13} {EY-4} Q{CX} {EY-12} {CX+13} {EY-4}" fill="none" stroke="{color}" stroke-width="4"/>'
    s += f'<path d="M{CX-79} {EY-8} L{CX-100} {EY-4}" stroke="{color}" stroke-width="4"/><path d="M{CX+79} {EY-8} L{CX+100} {EY-4}" stroke="{color}" stroke-width="4"/>'
    return s

def mouth(kind, skin):
    lip = shade(skin, .55)
    if kind == 'grin':
        return (f'<path d="M270 390 Q300 432 330 390 Q300 398 270 390 Z" fill="#5a1d1d"/>'
                f'<path d="M274 392 Q300 400 326 392 L323 400 Q300 407 277 400 Z" fill="#fff"/>'
                f'<path d="M284 416 Q300 424 316 416" fill="none" stroke="#c25a5a" stroke-width="4" stroke-linecap="round"/>')
    if kind == 'smile':
        return f'<path d="M276 392 Q300 412 324 392" fill="none" stroke="{lip}" stroke-width="4" stroke-linecap="round"/>'
    if kind == 'smirk':
        return f'<path d="M282 398 Q304 404 322 390" fill="none" stroke="{lip}" stroke-width="4" stroke-linecap="round"/>'
    if kind == 'pout':
        return (f'<path d="M282 396 Q300 392 318 396" fill="none" stroke="{lip}" stroke-width="4" stroke-linecap="round"/>'
                f'<path d="M288 404 Q300 410 312 404" fill="none" stroke="{shade(skin,.8)}" stroke-width="3" stroke-linecap="round"/>')
    return f'<path d="M284 398 Q300 400 316 397" fill="none" stroke="{lip}" stroke-width="4" stroke-linecap="round"/>'

def facial_hair(kind, color, face):
    wide = face == 'round'
    if kind == 'stubble':
        return (f'<path d="M222 364 C236 414 268 442 300 446 C332 442 364 414 378 364 C360 392 336 404 300 406 C264 404 240 392 222 364 Z" fill="{color}" opacity=".22"/>'
                f'<path d="M274 382 Q300 374 326 382 Q314 388 300 386 Q286 388 274 382 Z" fill="{color}" opacity=".3"/>')
    if kind == 'mustache':
        return (f'<path d="M222 364 C236 414 268 442 300 446 C332 442 364 414 378 364 C360 392 336 404 300 406 C264 404 240 392 222 364 Z" fill="{color}" opacity=".16"/>'
                f'<path d="M272 383 Q300 372 328 383 Q316 391 300 387 Q284 391 272 383 Z" fill="{color}" opacity=".85"/>')
    if kind == 'goatee':
        return (f'<path d="M270 384 Q300 370 330 384 Q322 393 300 388 Q278 393 270 384 Z" fill="{color}"/>'
                f'<path d="M282 408 Q300 402 318 408 L316 438 Q300 448 284 438 Z" fill="{color}"/>'
                f'<path d="M270 384 L276 404 M330 384 L324 404" stroke="{color}" stroke-width="5" stroke-linecap="round"/>')
    if kind == 'full':
        if wide:
            outer = "M190 300 C188 396 226 478 300 492 C374 478 412 396 410 300 L396 306 C394 352 376 382 350 388 C330 384 316 380 300 380 C284 380 270 384 250 388 C224 382 206 352 204 306 Z"
        else:
            outer = "M207 300 C205 390 238 468 300 482 C362 468 395 390 393 300 L380 306 C378 350 362 378 340 384 C324 380 312 378 300 378 C288 378 276 380 260 384 C238 378 222 350 220 306 Z"
        return (f'<path d="{outer}" fill="{color}"/>'
                f'<path d="M268 384 Q300 370 332 384 Q318 392 300 388 Q282 392 268 384 Z" fill="{shade(color,1.15)}"/>')
    if kind == 'trim':
        return (f'<path d="M208 318 C210 386 240 440 300 456 C360 440 390 386 392 318 L380 322 C376 380 350 422 300 432 C250 422 224 380 220 322 Z" fill="{color}"/>'
                f'<path d="M270 384 Q300 372 330 384 Q316 391 300 387 Q284 391 270 384 Z" fill="{color}"/>'
                f'<path d="M285 410 Q300 404 315 410 L313 432 Q300 437 287 432 Z" fill="{color}"/>'
                f'<path d="M270 384 Q262 396 268 408 M330 384 Q338 396 332 408" fill="none" stroke="{color}" stroke-width="6" stroke-linecap="round"/>')
    return ''

# ---------------- hair ----------------
def hair_back(style, c):
    d = {
        'messy': "M184 312 C160 206 214 128 300 124 C386 128 444 204 416 318 C404 286 398 262 386 250 L214 250 C202 266 192 288 184 312 Z",
        'short': "M204 284 C198 196 240 162 300 160 C360 162 402 196 396 284 C390 262 382 250 372 246 L228 246 C218 250 210 262 204 284 Z",
        'long': "M196 300 C176 150 424 150 404 300 C420 420 440 560 424 640 L372 610 C388 520 384 420 376 330 L224 330 C216 420 212 520 228 610 L176 640 C160 560 180 420 196 300 Z",
        'bob': "M188 360 C170 170 430 170 412 360 L382 356 L218 356 Z",
        'ponytail': "M200 300 C186 176 414 176 400 300 Z M392 214 C470 204 488 310 454 430 C446 348 426 280 384 250 Z",
        'buns': "M200 300 C188 186 412 186 400 300 Z M205 200 a52 52 0 1 0 1 0 Z M395 200 a52 52 0 1 0 1 0 Z",
        'spiky': "M186 316 L176 250 L206 226 L190 170 L240 190 L250 128 L292 172 L318 116 L344 172 L392 136 L394 198 L438 186 L412 240 L430 300 L412 316 Z",
        'wild': "M178 330 C150 290 150 230 184 214 C168 170 214 132 250 146 C262 110 318 104 340 134 C370 110 424 136 420 182 C454 196 460 262 428 296 C436 318 430 334 420 340 Z",
        'undercut': "M206 280 C196 176 290 128 360 150 C420 170 430 240 410 300 L392 250 L214 262 Z",
        'hood': "M150 520 C130 330 176 160 300 150 C424 160 470 330 450 520 L396 470 C400 350 380 250 300 244 C220 250 200 350 204 470 Z",
    }.get(style)
    return f'<path d="{d}" fill="{c}"/>' if d else ''

def hair_front(style, c):
    hi = shade(c, 1.35)
    if style == 'messy':
        return (f'<path d="M204 272 C210 198 264 166 318 172 C372 180 404 222 398 280 C386 246 372 236 360 238 C368 260 360 274 350 282 C346 254 330 240 316 242 C322 266 310 280 296 288 C300 262 288 246 272 244 C268 266 256 276 240 284 C248 264 244 250 232 248 C222 258 212 266 204 272 Z" fill="{c}"/>'
                f'<path d="M278 150 C266 116 236 112 222 128 M328 146 C348 112 382 118 392 136 M300 140 C302 110 290 96 276 94" fill="none" stroke="{c}" stroke-width="7" stroke-linecap="round"/>'
                f'<path d="M246 190 C276 170 322 168 356 186" fill="none" stroke="{hi}" stroke-width="5" opacity=".6" stroke-linecap="round"/>'
                f'<path d="M232 246 C236 234 244 226 254 222 M318 240 C324 226 334 218 348 216" fill="none" stroke="{hi}" stroke-width="3" opacity=".45" stroke-linecap="round"/>')
    if style == 'short':
        return (f'<path d="M210 266 C222 220 260 202 300 202 C340 202 378 220 390 266 C374 248 352 240 330 242 C310 236 290 236 270 242 C248 240 226 248 210 266 Z" fill="{c}"/>'
                f'<rect x="204" y="262" width="10" height="44" rx="4" fill="{c}"/><rect x="386" y="262" width="10" height="44" rx="4" fill="{c}"/>'
                f'<path d="M244 214 C276 200 324 200 356 214" fill="none" stroke="{hi}" stroke-width="4" opacity=".5" stroke-linecap="round"/>')
    if style in ('spiky', 'wild', 'undercut'):
        side = style == 'undercut'
        d = ("M214 280 C226 210 290 176 360 190 C400 200 412 240 404 290 C390 262 372 250 350 250 C330 268 300 280 270 282 C290 266 296 254 294 240 C270 254 244 270 214 280 Z" if side else
             "M206 276 L222 214 L246 250 L262 196 L284 248 L304 190 L322 246 L344 196 L358 250 L382 214 L396 276 C380 256 360 250 340 254 L300 262 L260 254 C240 250 220 256 206 276 Z")
        return f'<path d="{d}" fill="{c}"/><path d="M250 204 C280 186 320 186 350 200" fill="none" stroke="{hi}" stroke-width="4" opacity=".5" stroke-linecap="round"/>'
    if style in ('long', 'bob', 'ponytail', 'buns'):
        return (f'<path d="M208 300 C204 214 256 186 300 186 C352 186 398 214 392 300 C380 268 364 252 346 248 C336 262 316 272 292 274 C300 262 302 252 300 244 C282 262 250 274 222 280 C216 286 212 292 208 300 Z" fill="{c}"/>'
                f'<path d="M244 214 C274 198 326 198 356 212" fill="none" stroke="{hi}" stroke-width="5" opacity=".55" stroke-linecap="round"/>')
    return ''

# ---------------- headwear ----------------
def headcloth(kind):
    outer = "M300 138 C182 140 146 236 158 332 C166 410 150 480 116 580 L206 606 C220 530 226 466 222 404 L214 306 C220 250 258 230 300 230 C342 230 380 250 386 306 L378 404 C374 466 380 530 394 606 L484 580 C450 480 434 410 442 332 C454 236 418 140 300 138 Z"
    fill = 'url(#shemagh)' if kind == 'red' else 'url(#ghutra)'
    edge = '#b3122a' if kind == 'red' else '#d7dde2'
    return (f'<path d="{outer}" fill="{fill}"/>'
            f'<path d="{outer}" fill="url(#clothShade)"/>'
            f'<path d="M214 306 C220 250 258 230 300 230 C342 230 380 250 386 306" fill="none" stroke="{edge}" stroke-width="5" opacity=".7"/>'
            # agal (two black rings)
            f'<path d="M180 206 Q300 176 420 206" fill="none" stroke="#141414" stroke-width="11" stroke-linecap="round"/>'
            f'<path d="M170 222 Q300 262 430 222" fill="none" stroke="#0c0c0c" stroke-width="15" stroke-linecap="round"/>'
            f'<path d="M176 238 Q300 280 424 238" fill="none" stroke="#141414" stroke-width="13" stroke-linecap="round"/>'
            f'<path d="M200 232 Q300 262 400 232" fill="none" stroke="#555" stroke-width="3" opacity=".6" stroke-linecap="round"/>')

# ---------------- outfits ----------------
def outfit(kind, color, bkind, extras):
    b = body(bkind)
    s = ''
    if kind == 'thobe':
        s += f'<path d="{b}" fill="url(#thobe)"/>'
        s += f'<path d="{b}" fill="url(#bodyShade)"/>'
        s += '<path d="M252 486 Q300 506 348 486 L352 516 Q300 536 248 516 Z" fill="#f7f9fb" stroke="#c7d0d8" stroke-width="2"/>'
        if 'collar' in extras:  # spread collar points
            s += '<path d="M256 500 L222 590 L292 540 Z" fill="#fbfcfd" stroke="#c7d0d8" stroke-width="2"/><path d="M344 500 L378 590 L308 540 Z" fill="#fbfcfd" stroke="#c7d0d8" stroke-width="2"/>'
        s += '<path d="M300 534 L300 800" stroke="#c3ccd4" stroke-width="3"/>'
        for y in (556, 590, 624):
            s += f'<circle cx="309" cy="{y}" r="4" fill="#dfe5ea" stroke="#b7c1ca"/>'
        if 'pocket' in extras or 'pen' in extras:
            s += '<path d="M372 632 L446 624 L452 700 L378 708 Z" fill="none" stroke="#c3ccd4" stroke-width="3"/>'
        if 'pen' in extras:
            s += '<rect x="392" y="604" width="9" height="34" rx="3" fill="#20232a"/><rect x="392" y="604" width="9" height="8" rx="3" fill="#c9a24a"/>'
    elif kind == 'tee':
        s += f'<path d="{b}" fill="{color}"/>'
        s += f'<path d="{b}" fill="url(#bodyShade)"/>'
        s += f'<path d="M244 496 Q300 548 356 496" fill="none" stroke="{shade(color,.7)}" stroke-width="10" stroke-linecap="round"/>'
    elif kind == 'jacket':
        s += f'<path d="{b}" fill="{color}"/><path d="{b}" fill="url(#bodyShade)"/>'
        s += f'<path d="M262 512 L230 640 L300 600 L370 640 L338 512 Z" fill="{shade(color,.75)}"/>'
        s += f'<path d="M300 600 L300 800" stroke="{shade(color,.55)}" stroke-width="4"/><path d="M300 604 L300 800" stroke="#d8d8d8" stroke-width="1.5" stroke-dasharray="4 5" opacity=".6"/>'
        s += f'<path d="M262 512 Q300 560 338 512" fill="{shade(color,.4)}"/>'
    elif kind == 'hoodie':
        s += f'<path d="{b}" fill="{color}"/><path d="{b}" fill="url(#bodyShade)"/>'
        s += f'<path d="M218 500 C230 470 262 460 300 470 C338 460 370 470 382 500 C370 560 330 580 300 582 C270 580 230 560 218 500 Z" fill="{shade(color,.72)}"/>'
        s += f'<path d="M248 512 Q300 560 352 512" fill="none" stroke="{shade(color,.5)}" stroke-width="8"/>'
        s += '<path d="M282 548 L278 640 M318 548 L322 640" stroke="#f1f1f1" stroke-width="4" stroke-linecap="round"/><circle cx="278" cy="644" r="5" fill="#ddd"/><circle cx="322" cy="644" r="5" fill="#ddd"/>'
        s += f'<path d="M210 700 L390 700 L380 780 L220 780 Z" fill="{shade(color,.85)}" opacity=".6"/>'
    elif kind == 'cloak':
        s += f'<path d="{b}" fill="{color}"/><path d="{b}" fill="url(#bodyShade)"/>'
        s += f'<path d="M230 520 Q300 600 370 520" fill="none" stroke="{shade(color,1.4)}" stroke-width="5"/><circle cx="300" cy="570" r="11" fill="#e8c46a" stroke="#8a6a20" stroke-width="3"/>'
    elif kind == 'vest':
        s += f'<path d="{b}" fill="#e9e3d6"/><path d="{b}" fill="url(#bodyShade)"/>'
        s += f'<path d="M150 600 C170 560 230 530 262 516 L280 800 L120 800 Z" fill="{color}"/><path d="M450 600 C430 560 370 530 338 516 L320 800 L480 800 Z" fill="{color}"/>'
        s += f'<path d="M262 512 Q300 548 338 512" fill="none" stroke="#b9b1a0" stroke-width="6"/>'
    elif kind == 'tank':
        s += f'<path d="{b}" fill="{shade(color,.9)}"/><path d="{b}" fill="url(#bodyShade)"/>'
        s += f'<path d="M210 560 Q300 640 390 560 L400 800 L200 800 Z" fill="{color}"/>'
        s += f'<path d="M150 590 C200 640 250 700 270 800" fill="none" stroke="#7a5a3a" stroke-width="10"/>'
    return s

def extras_front(extras, accent, hair):
    s = ''
    if 'scarf' in extras:
        s += f'<path d="M226 506 C264 548 336 548 374 506 L392 560 C336 596 264 596 208 560 Z" fill="{accent}" opacity=".9"/><path d="M346 560 L396 690 L360 696 L326 574 Z" fill="{shade(accent,.8)}"/>'
    if 'earring' in extras:
        s += f'<circle cx="396" cy="372" r="7" fill="{accent}"/>'
    if 'circlet' in extras:
        s += f'<path d="M216 262 Q300 226 384 262" fill="none" stroke="#e8c46a" stroke-width="5"/><circle cx="300" cy="240" r="9" fill="{accent}" stroke="#e8c46a" stroke-width="3"/>'
    if 'bandana' in extras:
        s += f'<path d="M206 262 Q300 214 394 262 L392 284 Q300 240 208 284 Z" fill="{accent}"/><path d="M392 268 L446 300 L430 322 L388 286 Z" fill="{shade(accent,.8)}"/>'
    if 'goggles' in extras:
        s += f'<path d="M204 238 Q300 208 396 238" fill="none" stroke="#3a2a1a" stroke-width="10"/>'
        for cx in (256, 344):
            s += f'<circle cx="{cx}" cy="224" r="27" fill="#22303a" stroke="#c9a24a" stroke-width="7"/><circle cx="{cx-8}" cy="216" r="7" fill="{accent}" opacity=".7"/>'
    if 'cap' in extras:  # backwards cap
        s += f'<path d="M194 268 C190 150 410 150 406 268 C380 250 340 242 300 242 C260 242 220 250 194 268 Z" fill="{accent}"/>'
        s += f'<path d="M194 268 C220 250 260 242 300 242 C340 242 380 250 406 268" fill="none" stroke="{shade(accent,.6)}" stroke-width="7"/>'
        s += f'<path d="M262 250 Q300 226 338 250 L332 262 Q300 246 268 262 Z" fill="#1b1411"/><circle cx="300" cy="160" r="8" fill="{shade(accent,.7)}"/>'
        s += f'<path d="M226 190 Q300 168 374 190" fill="none" stroke="#fff" stroke-width="4" opacity=".35" stroke-linecap="round"/>'
    if 'shades' in extras:
        for cx in (CX - 46, CX + 46):
            s += f'<path d="M{cx-34} {EY-16} L{cx+32} {EY-16} Q{cx+34} {EY+22} {cx} {EY+24} Q{cx-36} {EY+22} {cx-34} {EY-16} Z" fill="#0b0f14" stroke="#2a2a2e" stroke-width="3"/>'
            s += f'<path d="M{cx-22} {EY-8} l18 -2" stroke="{accent}" stroke-width="4" opacity=".7" stroke-linecap="round"/>'
        s += f'<path d="M{CX-14} {EY-10} Q{CX} {EY-16} {CX+14} {EY-10}" fill="none" stroke="#2a2a2e" stroke-width="5"/>'
    if 'bisht' in extras:
        s += '<path d="M40 800 C52 628 150 548 236 518 L276 800 Z" fill="#3a2414"/><path d="M560 800 C548 628 450 548 364 518 L324 800 Z" fill="#3a2414"/>'
        s += '<path d="M236 518 L276 800 M364 518 L324 800" stroke="#e0b24a" stroke-width="7"/><path d="M236 518 L276 800 M364 518 L324 800" stroke="#fff3c0" stroke-width="2" opacity=".6"/>'
        s += '<path d="M40 800 C52 628 150 548 236 518" fill="none" stroke="#000" stroke-opacity=".25" stroke-width="4"/>'
    if 'scar' in extras:
        s += '<path d="M352 280 L366 340" stroke="#b86a5a" stroke-width="4" stroke-linecap="round"/>'
    if 'misbaha' in extras:
        beads = ''
        for i in range(19):
            t = i / 18
            a = math.pi * (0.1 + 0.8 * t)
            x = 300 + math.cos(a) * 110
            y = 690 + math.sin(a) * 60
            beads += f'<circle cx="{x:.1f}" cy="{y:.1f}" r="8" fill="#2a1c14" stroke="#5a4030" stroke-width="2"/>'
        s += beads + '<path d="M300 752 L300 790" stroke="#2a1c14" stroke-width="5"/><path d="M290 790 L310 790 L306 800 L294 800 Z" fill="#6a4a2a"/>'
    if 'wrinkles' in extras:
        s += f'<path d="M218 330 l-10 4 M382 330 l10 4" stroke="{shade("#b98060",.6)}" stroke-width="2" stroke-linecap="round" opacity=".6"/>'
    return s

# ---------------- scene ----------------
def svg_doc(C, viewbox):
    acc = C['accent']; skin = C['skin']; hc = C.get('hair_color', '#1b1411')
    face = C.get('face', 'default')
    fp = face_path(face)
    defs = f'''<defs>
<radialGradient id="bg" cx="50%" cy="36%" r="78%"><stop offset="0" stop-color="{acc}" stop-opacity=".55"/><stop offset=".42" stop-color="{C['bg']}"/><stop offset="1" stop-color="#050b0e"/></radialGradient>
<linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{acc}" stop-opacity=".35"/><stop offset="1" stop-color="#050b0e" stop-opacity="0"/></linearGradient>
<radialGradient id="iris" cx="50%" cy="70%" r="70%"><stop offset="0" stop-color="{shade(C.get('iris','#5a3a26'),1.5)}"/><stop offset=".6" stop-color="{C.get('iris','#5a3a26')}"/><stop offset="1" stop-color="#140c08"/></radialGradient>
<linearGradient id="thobe" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#eef2f5"/><stop offset="1" stop-color="#c9d4dd"/></linearGradient>
<linearGradient id="bodyShade" x1="0" y1="0" x2="1" y2="0"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".32"/></linearGradient>
<linearGradient id="clothShade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".05"/><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></linearGradient>
<pattern id="shemagh" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="16" height="16" fill="#f3eee9"/><rect width="8" height="8" fill="#c8102e"/><rect x="8" y="8" width="8" height="8" fill="#c8102e"/><rect x="3" y="3" width="2" height="2" fill="#f3eee9"/></pattern>
<linearGradient id="ghutra" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e3e8ec"/></linearGradient>
<clipPath id="faceClip"><path d="{fp}"/></clipPath>
<filter id="rim" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="9"/></filter>
<filter id="soft"><feGaussianBlur stdDeviation="2"/></filter>
</defs>'''
    # background scene
    bg = (f'<rect width="600" height="800" fill="url(#bg)"/>'
          f'<g fill="#fff" opacity=".7"><circle cx="70" cy="90" r="1.6"/><circle cx="520" cy="70" r="1.3"/><circle cx="470" cy="190" r="1.9"/><circle cx="120" cy="240" r="1.1"/><circle cx="555" cy="300" r="1.5"/><circle cx="40" cy="330" r="1.2"/></g>'
          f'<rect y="560" width="600" height="240" fill="url(#sea)"/>'
          f'<path d="M0 560 H600" stroke="{acc}" stroke-opacity=".35" stroke-width="2"/>'
          # palms silhouettes
          f'<g fill="#050b0e" opacity=".85"><path d="M40 800 C52 700 60 620 78 540 L86 542 C72 620 66 700 58 800 Z"/><path d="M82 540 C40 520 10 530 -10 552 C30 528 60 534 80 546 Z M82 540 C110 500 150 496 176 510 C140 506 110 516 86 546 Z M82 540 C60 500 30 486 0 490 C36 494 62 510 80 544 Z M82 540 C120 530 150 546 166 570 C136 548 112 544 86 546 Z"/>'
          f'<path d="M560 800 C548 710 540 640 522 570 L514 572 C528 640 536 710 544 800 Z"/><path d="M518 570 C560 552 590 560 610 580 C570 558 540 564 520 576 Z M518 570 C490 532 450 528 424 542 C460 538 490 548 514 576 Z M518 570 C540 532 572 520 600 524 C564 528 538 544 520 574 Z"/></g>')
    skin_sh = shade(skin, .8)
    # silhouette for rim light
    headwear = C.get('headwear')
    sil = f'<path d="{body(C.get("build","normal"))}"/><path d="{fp}"/>'
    if headwear:
        sil += '<path d="M300 138 C182 140 146 236 158 332 C166 410 150 480 116 580 L484 580 C450 480 434 410 442 332 C454 236 418 140 300 138 Z"/>'
    else:
        sil += hair_back(C.get('hair', 'short'), '#000').replace('fill="#000"', '')
    rim = f'<g fill="{acc}" filter="url(#rim)" transform="translate(-8 -6)" opacity=".9">{sil}</g>'
    parts = [rim]
    if not headwear:
        parts.append(hair_back(C.get('hair', 'short'), hc))
    parts.append(outfit(C.get('outfit', 'thobe'), C.get('outfit_color', '#556'), C.get('build', 'normal'), C.get('extras', [])))
    parts.append(neck(skin, C.get('build', 'normal')))
    # ears
    parts.append(f'<ellipse cx="{200 if face!="round" else 184}" cy="332" rx="14" ry="24" fill="{skin_sh}"/><ellipse cx="{400 if face!="round" else 416}" cy="332" rx="14" ry="24" fill="{skin_sh}"/>')
    # face + cel shadow
    parts.append(f'<path d="{fp}" fill="{skin}"/>')
    parts.append(f'<g clip-path="url(#faceClip)"><path d="M338 190 C400 250 408 340 356 452 L440 470 L440 190 Z" fill="{skin_sh}" opacity=".55"/>'
                 f'<ellipse cx="300" cy="238" rx="120" ry="30" fill="{skin_sh}" opacity=".45"/></g>')
    # blush
    parts.append(f'<ellipse cx="246" cy="366" rx="18" ry="7" fill="#ff8a7a" opacity=".22"/><ellipse cx="354" cy="366" rx="18" ry="7" fill="#ff8a7a" opacity=".22"/>')
    parts.append(facial_hair(C.get('facial_hair', ''), C.get('beard_color', hc), face))
    # nose
    parts.append(f'<path d="M304 346 Q312 366 300 372" fill="none" stroke="{shade(skin,.62)}" stroke-width="3" stroke-linecap="round"/><path d="M292 372 Q298 376 304 372" fill="none" stroke="{shade(skin,.6)}" stroke-width="2" opacity=".6"/>')
    parts.append(mouth(C.get('mouth', 'neutral'), skin))
    ek = C.get('eyes', 'soft')
    lash = C.get('lash', '#1a100c')
    fem = C.get('fem', False)
    parts.append(eye(CX - 46, -1, ek, C.get('iris'), lash, fem))
    parts.append(eye(CX + 46, 1, ek, C.get('iris'), lash, fem))
    parts.append(brows(C.get('brows', 'soft'), C.get('brow_color', hc), 5 if fem else 7))
    if not headwear:
        parts.append(hair_front(C.get('hair', 'short'), hc))
    if headwear:
        parts.append(headcloth(headwear))
    if C.get('glasses'):
        parts.append(glasses())
    parts.append(extras_front(C.get('extras', []), acc, hc))
    char = f'<g transform="translate(300 600) scale(1.12) translate(-300 -600)">{"".join(parts)}</g>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{viewbox}" preserveAspectRatio="xMidYMid slice">{defs}{bg}{char}</svg>'

# ---------------- roster ----------------
SA = '#3a2418'
ROSTER = [
    # --- based on the provided reference photos ---
    dict(slug='saqr', accent='#7fd6ff', bg='#10283a', skin='#d8a47e', hair='messy', hair_color='#231611', eyes='sleepy', brows='serious', mouth='pout', facial_hair='stubble', outfit='thobe', extras=['collar'], iris=SA),
    dict(slug='jabal', accent='#ffb347', bg='#2a1a10', skin='#c98f68', face='round', build='broad', hair='short', hair_color='#141010', eyes='soft', brows='thick', mouth='smile', facial_hair='full', outfit='tee', outfit_color='#9fb4bf', iris=SA),
    dict(slug='shaheen', accent='#ff5d7a', bg='#2a0f18', skin='#c98f66', headwear='red', eyes='happy', brows='raised', brow_color='#1a120e', mouth='grin', facial_hair='trim', beard_color='#1a120e', outfit='thobe', extras=['pen'], iris=SA),
    dict(slug='hakeem', accent='#e0b872', bg='#221a0f', skin='#bd8563', face='mature', headwear='red', glasses=True, eyes='soft', brows='soft', brow_color='#2a2420', mouth='smile', facial_hair='goatee', beard_color='#3b3632', outfit='thobe', extras=['pen', 'wrinkles'], iris=SA),
    dict(slug='sultan', accent='#c9a7ff', bg='#1d1533', skin='#d49a70', hair='short', hair_color='#120e0c', eyes='soft', brows='soft', mouth='smile', facial_hair='trim', outfit='thobe', extras=['pocket', 'misbaha'], iris=SA),
    dict(slug='qadi', accent='#8bffcf', bg='#0d231d', skin='#caa07c', face='mature', headwear='white', glasses=True, eyes='sharp', brows='serious', brow_color='#1d1612', mouth='neutral', facial_hair='mustache', beard_color='#241a14', outfit='thobe', extras=['pocket'], iris=SA),
    # --- الشلة (بدون صور مرجعية — تصميم أصلي بنفس الأسلوب) ---
    dict(slug='dekho', accent='#b8ff5a', bg='#17240c', skin='#d49b72', hair='short', hair_color='#1a120e', eyes='soft', brows='raised', mouth='grin', facial_hair='stubble', outfit='hoodie', outfit_color='#2e3440', extras=['cap'], iris=SA),
    dict(slug='abood', accent='#5ab8ff', bg='#0e1f33', skin='#dcaa84', hair='short', hair_color='#18110d', eyes='soft', brows='soft', mouth='smile', facial_hair='stubble', outfit='tee', outfit_color='#27406b', iris=SA),
    dict(slug='emad', accent='#3ee6c4', bg='#0b2724', skin='#cf9a74', hair='short', hair_color='#1c1410', glasses=True, eyes='soft', brows='soft', mouth='neutral', facial_hair='trim', outfit='thobe', extras=['pocket'], iris=SA),
    dict(slug='rayes', accent='#ffcf4a', bg='#2a200a', skin='#c48a62', headwear='red', eyes='sharp', brows='serious', brow_color='#150f0b', mouth='smirk', facial_hair='full', beard_color='#150f0b', outfit='thobe', extras=['bisht', 'shades'], iris=SA),
    dict(slug='abdulmajeed', accent='#b18cff', bg='#1a1330', skin='#caa07c', headwear='white', eyes='soft', brows='soft', brow_color='#1d1612', mouth='smile', facial_hair='goatee', beard_color='#1d1612', outfit='thobe', extras=['pen'], iris=SA),
    dict(slug='hamdan', accent='#4ade80', bg='#0c2616', skin='#c28a60', hair='short', hair_color='#120d0a', eyes='sharp', brows='thick', mouth='smirk', facial_hair='full', outfit='jacket', outfit_color='#1f6b3a', iris=SA),
    dict(slug='muneer', accent='#ff9a3c', bg='#2b170a', skin='#e0b089', hair='messy', hair_color='#2e1d14', eyes='happy', brows='raised', mouth='grin', outfit='jacket', outfit_color='#c2561c', iris=SA),
    dict(slug='abuhanay', accent='#ff7a6b', bg='#2a1210', skin='#b98060', face='mature', headwear='red', glasses=True, eyes='soft', brows='soft', brow_color='#9a948e', mouth='smile', facial_hair='full', beard_color='#9a948e', outfit='thobe', extras=['wrinkles', 'pen'], iris=SA),
    # --- original island survivors ---
    dict(slug='riven', accent='#6fb8ff', bg='#0f1e33', skin='#f0c9a6', hair='spiky', hair_color='#1c2a44', eyes='sharp', brows='serious', mouth='smirk', outfit='jacket', outfit_color='#23606e', extras=['scarf'], iris='#2f7fd0'),
    dict(slug='kael', accent='#ff9f43', bg='#2a1a10', skin='#e6b48c', hair='wild', hair_color='#8a3d17', eyes='sharp', brows='thick', mouth='grin', outfit='vest', outfit_color='#6b4a2a', extras=['scar'], iris='#c46a1a'),
    dict(slug='mira', accent='#c9a7ff', bg='#1d1533', skin='#f3d2b8', face='soft', fem=True, build='slim', hair='long', hair_color='#8e7bd6', eyes='soft', brows='soft', mouth='smile', outfit='cloak', outfit_color='#3b2a66', extras=['circlet'], iris='#7a54d8'),
    dict(slug='nox', accent='#8bffcf', bg='#0d231d', skin='#c9a88c', hair='hood', hair_color='#141c1a', eyes='sharp', brows='serious', mouth='neutral', outfit='cloak', outfit_color='#16221f', iris='#1fbf8a'),
    dict(slug='ayla', accent='#5ee6d8', bg='#0c2b2e', skin='#e9b98f', face='soft', fem=True, build='slim', hair='ponytail', hair_color='#1f6b66', eyes='soft', brows='soft', mouth='smile', outfit='tank', outfit_color='#1f7a73', extras=['earring'], iris='#19a89a'),
    dict(slug='raven', accent='#ff5d7a', bg='#2a0f18', skin='#f2d0bc', face='soft', fem=True, build='slim', hair='bob', hair_color='#141018', eyes='sharp', brows='serious', mouth='smirk', outfit='jacket', outfit_color='#5a1426', iris='#d0263e'),
    dict(slug='kairo', accent='#ffd166', bg='#29220c', skin='#c48d64', hair='messy', hair_color='#3b2616', eyes='soft', brows='raised', mouth='grin', outfit='jacket', outfit_color='#8a6a1c', extras=['goggles'], iris='#8a5a1a'),
    dict(slug='luna', accent='#b8d4ff', bg='#141c33', skin='#f5dccb', face='soft', fem=True, build='slim', hair='buns', hair_color='#c9d6ea', eyes='soft', brows='soft', mouth='smile', outfit='cloak', outfit_color='#2b3f66', iris='#6a8ad8'),
    dict(slug='zane', accent='#ff7847', bg='#2c140c', skin='#b88361', hair='undercut', hair_color='#1a1a1a', eyes='sharp', brows='serious', mouth='smirk', outfit='jacket', outfit_color='#a8431c', extras=['scar'], iris='#6a3a1a'),
    dict(slug='vera', accent='#9df0a8', bg='#10261a', skin='#e8c09c', face='soft', fem=True, build='slim', hair='long', hair_color='#5a3a22', eyes='soft', brows='soft', mouth='smile', outfit='vest', outfit_color='#2f6b44', iris='#3a8a4a'),
    dict(slug='sora', accent='#6fd0ff', bg='#0f1e33', skin='#eec3a0', hair='spiky', hair_color='#2a5a9a', eyes='soft', brows='raised', mouth='grin', outfit='tank', outfit_color='#2a5a9a', extras=['bandana'], iris='#2a7ad0'),
    dict(slug='ember', accent='#ff6a3d', bg='#2e120a', skin='#f0c3a2', face='soft', fem=True, build='slim', hair='wild', hair_color='#c2361a', eyes='sharp', brows='soft', mouth='smirk', outfit='vest', outfit_color='#5a1f14', extras=['earring'], iris='#e0601a'),
]

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        if f.endswith('.svg'):
            os.remove(os.path.join(OUT, f))
    for C in ROSTER:
        open(os.path.join(OUT, f"{C['slug']}.svg"), 'w').write(svg_doc(C, '0 0 600 800'))
        open(os.path.join(OUT, f"{C['slug']}-portrait.svg"), 'w').write(svg_doc(C, '105 70 390 390'))
    print('generated', len(ROSTER))
