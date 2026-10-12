#!/usr/bin/env python3
"""
papera.py — una papera raccoglie un limone da lontano e lo porta a chi apre il link.

Uso (come per Pensierini):
    uv run papera.py                                   # scrive index.html (three.js da CDN)
    uv run papera.py --three three.min.js              # three.js dentro la pagina: un unico file autonomo
    uv run papera.py --stile pixel                     # versione in pixel art
    uv run papera.py --frammento -o anteprima.html     # senza <html>/<head>, per l'anteprima su claude.ai

Divisione dei compiti
  - Questo file è la regia: dove cammina la papera, quando si ferma, quando si china,
    dove guarda, quando sbatte le palpebre, cosa pensa; più colori e misure.
    Esporta tutto in un JSON compatto.
  - renderer.js costruisce papera, limone e prato in 3D (three.js) e li anima leggendo quel JSON.
  - template.html è il guscio della pagina.

Nessuna dipendenza esterna: solo libreria standard.
"""
from __future__ import annotations

import argparse
import base64
import json
import math
import random
from pathlib import Path

QUI = Path(__file__).resolve().parent

# ═══════════════════════════ Le cose che si cambiano più spesso ═══════════════════════════

TITOLO = "Un limone per te"                                 # nome nella scheda del browser
NUVOLETTA = ["Non essere scocciata,", "piuttosto facciamo", "una limonata insieme"]   # una voce per riga
PAROLA_IN_GIALLO = "limonata"                                # "" = tutto dello stesso colore
STILE = "morbido"            # "morbido": 3D illustrato · "pixel": pixel art da gioco cozy
SEME = 7                     # cambia le piccole irregolarità (erba, sassolini, fiori)

# ═══════════════════════════ Luoghi (metri) ═══════════════════════════
# Terreno piano a y = 0. x cresce verso destra, z verso chi guarda.
# Lo spettatore è nella posizione di CAMERA; la papera finisce in ARRIVO col muso verso di lui.

SENTIERO = [(-6.4, -32.0), (-4.6, -21.0), (-2.9, -12.5), (-1.95, -7.6), (-1.32, -5.05),
            (-0.4, -3.25), (0.48, -1.7), (0.3, -0.6), (0.05, 0.3), (-0.3, 1.5), (-0.7, 3.8)]
LARGHEZZA_SENTIERO = 0.64

# La papera entra già camminando dall'erba a sinistra e si ferma davanti al limone,
# che è a terra sul sentiero con il rametto rivolto verso di lei.
ENTRATA = [(-3.0, -5.42), (-2.55, -5.3), (-2.08, -5.2), (-1.66, -5.12)]

# Dopo averlo raccolto si gira e segue il sentiero fino a te.
AVVICINAMENTO = [(-1.66, -5.12), (-1.28, -4.32), (-0.42, -3.22), (0.4, -1.78),
                 (0.24, -0.72), (0.02, -0.12), (0.0, 0.0)]

# ═══════════════════════════ Tempi (secondi) e andatura ═══════════════════════════

TEMPI = dict(
    dissolvenza=1.6,      # la scena emerge dal colore del cielo
    curiosita=0.85,       # ferma davanti al limone, lo guarda e piega la testa
    chinata=0.8,          # scende col becco fino al rametto
    sollevata=0.8,        # risale con il limone appeso
    contenta=0.75,        # scodinzola soddisfatta
    giro=1.2,             # si gira verso di te
    assestamento=0.45,    # appena arrivata
    posa=1.5,             # abbassa il limone fino a terra, davanti a te
    rialzata=0.75,
    guarda_limone=0.75,
    guarda_te=0.55,       # poi parte la nuvoletta
)
VELOCITA = dict(entrata=0.38, avvicinamento=0.5)    # metri al secondo
FALCATA = 0.17                                      # metri per un ciclo completo sinistro + destro

# ═══════════════════════════ Inquadratura ═══════════════════════════

CAMERA = dict(
    posizione_inizio=(0.18, 0.64, 1.95),
    posizione_fine=(0.04, 0.44, 1.38),
    mira_inizio=(-1.45, 0.17, -5.05),     # all'inizio guarda il limone lontano
    mira_fine=(0.13, 0.2, 0.0),           # alla fine, papera e limone davanti a te (un po' a sinistra: a destra c'è la nuvoletta)
    fov_inizio=21.0,                      # gradi in verticale: all'inizio un po' "teleobiettivo"
    fov_fine=32.0,
)

# ═══════════════════════════ Colori e misure ═══════════════════════════

PAPERA = dict(
    # germano reale maschio: testa verde cangiante, collarino bianco, petto castano, fianchi grigi
    livrea=dict(
        testa="#1C6B3A", collarino=0.46,          # collarino: dove sta l'anello bianco lungo il collo (0-1)
        petto="#6A3523", fianchi="#C6C1BA", pancia="#E4D8CE", dorso="#7F7A70", codrione="#16161A",
        ala="#8E897F", copritrici="#9D988D", specchio="#2C3FA6", primarie="#5A544D", coda="#DAD7CF",
    ),
    becco="#C9B93C", becco_chiaro="#D8CA55", becco_scuro="#9C8F2A", unghia="#55503A",
    narici="#4E4A1E", occhio="#1F120C",
    zampe="#F49A34", palmatura="#E9852A", unghie_zampe="#6E4B2E",
    # misure in metri: una papera paffuta di poco meno di quaranta centimetri
    corpo=dict(larghezza=0.106, altezza=0.092, avanti=0.15, dietro=0.172, coda_su=0.04,
               centro_y=0.13, beccheggio=-0.42),
    testa=dict(raggio=0.066, y=0.305, z=0.088),
    becco_misure=dict(lunghezza=0.088, larghezza=0.0238, spessore=0.0108, curva=0.0034, uncino=0.0029),
    occhio_raggio=0.0118,
    passo_laterale=0.04,
    dito=0.052,
)

LIMONE = dict(
    buccia="#F4C327", buccia_chiara="#FADA4E", buccia_verde="#B9B43A", buccia_scura="#D9A11A",
    foglia="#2E5C24", foglia_chiara="#4F7F32", nervatura="#A4BD5C", rametto="#6E6A33",
    raggio=0.032, lunghezza=0.104, rametto_lungo=0.036,
)

AMBIENTE = dict(
    zenit="#9DC2DF", orizzonte="#EEE8D6", sole="#FFE6B8",
    terra_lontana="#7D8F5A",
    erba_scura="#5E7C3B", erba_media="#7E9C4C", erba_chiara="#B2C46F", erba_secca="#BDB27A",
    prato_base="#435B2B", prato_lontano="#6A8840",
    sentiero="#C6AB82", sentiero_scuro="#A68A62", sentiero_chiaro="#D8C4A0", sassolini="#DCD5C7",
    margherite="#FFFDF8", margherite_punte="#F4C6CF", margherite_cuore="#F2C230",
    luce_sole="#FFF1DC", intensita_sole=1.75, direzione_sole=(-0.62, 0.66, 0.42),
    cielo_emisfero="#D3E3F0", terra_emisfero="#968E78", intensita_emisfero=0.26,
    intensita_controluce=0.55,
    esposizione=0.74,
    nebbia=(6.0, 170.0),
    colline="#86A06A", colline_lontane="#A3B5A4",
    erba_quanti=115000,        # fili d'erba: meno = più leggero
    margherite_quante=90,
)

FUMETTO = dict(
    riempimento="#FFFDF6", contorno="#4B3A2C", testo="#4B3A2C",
    giallo="#F6C92E", giallo_pixel="#F2B51F",
    font_morbido="Nuvoletta", font_pixel="NuvolettaPixel",
)

PIXEL = dict(
    righe=216,           # risoluzione verticale della scena in pixel art (più basso = pixel più grossi)
    contorno="#3B2F3A",  # contorno scuro attorno a papera e limone
    carattere=16,        # corpo del carattere a pixel della nuvoletta (16 è quello più nitido)
    quota_testo=0.05,    # altezza di una riga di testo, in frazione dello schermo
    retino=0.035,        # quanto retino (dithering) nelle sfumature
    luce=[58, 108, 158, 190],   # gradini di luce su papera e limone (0-255)
    # tavolozza: ogni pixel prende il colore più vicino del proprio gruppo
    tavolozza=dict(
        ambiente=[
            "#ECE7D6", "#DEE3DC", "#CBD9DF", "#D5DAB6", "#BFCB97",                      # cielo e colline
            "#3F5E33", "#50703B", "#627F48", "#729154", "#85A35F", "#99B46C", "#B2C47F", "#C9D196",  # prato
            "#E5DCC8", "#D9CCB1", "#CDBE9F", "#BFAE8D", "#AE9C7C", "#978873", "#7E705E", "#665A4E",  # sentiero e ombre
            "#FFFCF4", "#F8D343", "#F4C6CF",                                            # margherite
        ],
        papera=[
            "#3FA05C", "#24804A", "#17603A", "#0E4030", "#2A3D6E",                      # testa verde cangiante
            "#FFFCF4", "#DAD5CF", "#B9B4AD", "#8E8981", "#5F5A55",                      # collarino, fianchi, dorso
            "#9A4B30", "#6E3424", "#45221A",                                            # petto castano
            "#4F64D0", "#2C3FA6", "#1A2466", "#16161A",                                 # specchio, codrione
            "#E6D86A", "#C9B93C", "#8E8228",                                            # becco
            "#FFC766", "#F6A33C", "#DD7D2A", "#A9551E",                                 # zampe
        ],
        limone=[
            "#FFF1A6", "#FFE27A", "#F8D343", "#E2B12A", "#B98A23", "#8C6A22",            # buccia
            "#86B852", "#5A9A3E", "#3A6E30", "#26512B", "#7A6C3A",                       # foglie e rametto
        ],
    ),
    erba=dict(quanti=0.42, larghezza=2.2, vento=0.5),   # prato più rado e a fili più larghi: meno sfarfallio
)

# ═══════════════════════════ Regia ═══════════════════════════

K_GIRO = 0.13   # quanto "cammina sul posto" (metri di passo) per ogni radiante di rotazione


def _cr(p0, p1, p2, p3, t):
    t2, t3 = t * t, t * t * t
    return tuple(0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
                 for a, b, c, d in zip(p0, p1, p2, p3))


def curva(punti, fitta=80):
    """Catmull-Rom che passa per tutti i punti; restituisce una polilinea fitta."""
    P = [punti[0]] + list(punti) + [punti[-1]]
    out = []
    for i in range(1, len(P) - 2):
        for k in range(fitta):
            out.append(_cr(P[i - 1], P[i], P[i + 1], P[i + 2], k / fitta))
    out.append(tuple(punti[-1]))
    return out


def ricampiona(poli, passo):
    """Punti equidistanti lungo la polilinea. Restituisce (punti, lunghezza totale)."""
    cum = [0.0]
    for a, b in zip(poli, poli[1:]):
        cum.append(cum[-1] + math.dist(a, b))
    tot = cum[-1]
    n = max(2, int(tot / passo) + 1)
    out, j = [], 0
    for i in range(n):
        s = tot * i / (n - 1)
        while j < len(cum) - 2 and cum[j + 1] < s:
            j += 1
        seg = cum[j + 1] - cum[j]
        u = 0.0 if seg == 0 else (s - cum[j]) / seg
        a, b = poli[j], poli[j + 1]
        out.append((a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u))
    return out, tot


def diff_angolo(a, b):
    """a - b ridotto in (-pi, pi]."""
    d = (a - b) % (2 * math.pi)
    return d - 2 * math.pi if d > math.pi else d


def direzione(p, q):
    """Angolo di rotazione attorno a y per guardare da p verso q (0 = verso +z)."""
    return math.atan2(q[0] - p[0], q[1] - p[1])


class Regia:
    """Registra la traiettoria della papera a passo fisso, segmento dopo segmento."""

    def __init__(self, fps=30):
        self.dt = 1.0 / fps
        self.t = 0.0
        self.pos = None
        self.dir = 0.0
        self.passo = 0.0
        self.c = dict(t=[], x=[], z=[], dir=[], passo=[])
        self.eventi = {}

    def _registra(self):
        self.c["t"].append(self.t)
        self.c["x"].append(self.pos[0])
        self.c["z"].append(self.pos[1])
        self.c["dir"].append(self.dir)
        self.c["passo"].append(self.passo)

    def cammina(self, punti, v, in_corsa=False, avvio=0.16, frenata=0.30):
        poli, tot = ricampiona(curva(punti), 0.003)
        n = len(poli) - 1

        def punto(s):
            f = max(0.0, min(n, s / tot * n))
            i = min(int(f), n - 1)
            u = f - i
            a, b = poli[i], poli[i + 1]
            return (a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u)

        def verso(s):
            return direzione(punto(max(0.0, s - 0.03)), punto(min(tot, s + 0.03)))

        if self.pos is None:
            self.pos, self.dir = punto(0.0), verso(0.0)
            self._registra()
        s = 0.0
        sub = 8
        while s < tot - 1e-4:
            for _ in range(sub):
                r = tot - s
                k_in = 1.0 if in_corsa else math.sqrt(min(1.0, s / avvio))
                k_out = math.sqrt(min(1.0, r / frenata))
                vv = max(0.025, v * k_in * k_out)
                ds = min(vv * self.dt / sub, r)
                s += ds
                self.passo += ds
            self.t += self.dt
            p = punto(s)
            nd = verso(min(s, tot - 0.031))
            # la direzione segue la curva ma senza scatti
            self.dir += diff_angolo(nd, self.dir) * 0.5
            self.pos = p
            self._registra()
        return self.t

    def gira(self, verso_finale, durata):
        d0 = self.dir
        dd = diff_angolo(verso_finale, d0)
        n = max(1, round(durata / self.dt))
        for i in range(1, n + 1):
            u = i / n
            e = u * u * (3 - 2 * u)
            nd = d0 + dd * e
            self.passo += abs(nd - self.dir) * K_GIRO
            self.dir = nd
            self.t += self.dt
            self._registra()
        return self.t

    def fermo(self, durata):
        n = max(1, round(durata / self.dt))
        for _ in range(n):
            self.t += self.dt
            self._registra()
        return self.t


def peso_camminata(c, dt):
    """0 = ferma, 1 = cammina: dalla velocità con cui avanza il passo, lisciata avanti e indietro."""
    p = c["passo"]
    grezzo = [0.0] * len(p)
    for i in range(1, len(p)):
        grezzo[i] = min(1.0, max(0.0, (p[i] - p[i - 1]) / dt / 0.16))
    if len(p) > 1:
        grezzo[0] = grezzo[1]
    a = 1.0 - math.exp(-dt / 0.09)
    avanti, x = [], grezzo[0]
    for g in grezzo:
        x += (g - x) * a
        avanti.append(x)
    indietro, x = [0.0] * len(p), avanti[-1]
    for i in range(len(p) - 1, -1, -1):
        x += (avanti[i] - x) * a
        indietro[i] = x
    return indietro


def smooth(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def mix3(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def componi_regia(seme):
    rnd = random.Random(seme)
    R = Regia(fps=30)
    T = TEMPI
    ev = R.eventi

    # 1 · arriva dall'erba, già camminando, e si ferma davanti al limone
    R.cammina(ENTRATA, VELOCITA["entrata"], in_corsa=True, frenata=0.22)
    ev["ferma_limone"] = R.t
    R.fermo(T["curiosita"])
    ev["china_presa"] = R.t
    R.fermo(T["chinata"])
    ev["presa"] = R.t
    R.fermo(T["sollevata"])
    ev["sollevata"] = R.t
    R.fermo(T["contenta"])
    ev["giro"] = R.t

    # 2 · si gira verso lo spettatore e segue il sentiero
    R.gira(direzione(AVVICINAMENTO[0], AVVICINAMENTO[1]), T["giro"])
    ev["parte"] = R.t
    R.cammina(AVVICINAMENTO, VELOCITA["avvicinamento"], avvio=0.22, frenata=0.32)
    ev["arrivata"] = R.t
    # si raddrizza bene verso chi guarda
    cam = CAMERA["posizione_fine"]
    R.gira(direzione(R.pos, (cam[0], cam[2])), T["assestamento"])
    ev["china_posa"] = R.t
    R.fermo(T["posa"])
    ev["rilascio"] = R.t
    R.fermo(T["rialzata"])
    ev["rialzata"] = R.t
    R.fermo(T["guarda_limone"])
    ev["guarda_te"] = R.t
    R.fermo(T["guarda_te"])
    ev["nuvoletta"] = R.t
    R.fermo(6.0)
    ev["fine"] = R.t

    c = R.c
    c["peso"] = peso_camminata(c, R.dt)

    # dove guarda (bersaglio, peso, tempi): "limone", "camera", "terra_davanti", "avanti"
    sguardi = [
        (0.0, ev["ferma_limone"] - 0.3, "limone", 0.55),
        (ev["ferma_limone"] - 0.3, ev["china_presa"] + 0.2, "limone", 1.0),
        (ev["sollevata"] + 0.1, ev["giro"] + 0.4, "camera", 0.55),
        (ev["parte"] + 1.5, ev["parte"] + 3.2, "camera", 0.65),
        (ev["parte"] + 5.2, ev["arrivata"] - 0.6, "camera", 0.8),
        (ev["arrivata"] - 0.6, ev["china_posa"] + 0.1, "camera", 1.0),
        (ev["rialzata"] - 0.2, ev["guarda_te"] + 0.1, "limone", 1.0),
        (ev["guarda_te"], ev["fine"] + 600.0, "camera", 1.0),
    ]
    # testa piegata di lato (radianti, positivo = verso la sua sinistra)
    inclinazioni = [
        (ev["ferma_limone"] + 0.1, ev["china_presa"] + 0.05, 0.32),
        (ev["arrivata"] - 0.4, ev["china_posa"], -0.12),
        (ev["guarda_te"] + 0.25, ev["fine"] + 600.0, 0.2),
    ]
    # momenti di contentezza: scodinzola e muove un po' le ali
    contentezza = [
        (ev["sollevata"] - 0.1, ev["giro"] + 0.1, 1.0),
        (ev["guarda_te"] + 0.1, ev["guarda_te"] + 1.1, 1.0),
    ]
    # battiti di ciglia
    battiti, t = [], 0.9
    while t < ev["fine"] + 600:
        battiti.append(round(t, 3))
        t += rnd.uniform(2.3, 4.6)
    battiti += [round(ev["guarda_te"] + 0.18, 3), round(ev["guarda_te"] + 0.42, 3)]
    battiti.sort()

    return R, sguardi, inclinazioni, contentezza, battiti


def componi_camera(R):
    c, ev = R.c, R.eventi
    C = CAMERA
    n = len(c["t"])
    mira, pos, fov = [], [], []
    a = 1.0 - math.exp(-R.dt / 0.55)
    m = C["mira_inizio"]
    t_fin = ev["arrivata"]
    for i in range(n):
        t = c["t"][i]
        x, z = c["x"][i], c["z"][i]
        segui = (x, 0.17, z)
        w_segui = smooth(ev["giro"] - 0.2, ev["parte"] + 1.6, t)
        w_fine = smooth(t_fin - 3.4, t_fin + 0.6, t)
        bersaglio = mix3(mix3(C["mira_inizio"], segui, w_segui), C["mira_fine"], w_fine)
        m = mix3(m, bersaglio, a)
        mira.append(m)
        u = smooth(ev["giro"], t_fin + 0.4, t)
        pos.append(mix3(C["posizione_inizio"], C["posizione_fine"], u))
        fov.append(C["fov_inizio"] + (C["fov_fine"] - C["fov_inizio"]) * smooth(ev["giro"] - 0.5, t_fin - 1.0, t))
    return dict(pos=pos, mira=mira, fov=fov)


def arrotonda(x, n=4):
    if isinstance(x, float):
        return round(x, n)
    if isinstance(x, (list, tuple)):
        return [arrotonda(v, n) for v in x]
    if isinstance(x, dict):
        return {k: arrotonda(v, n) for k, v in x.items()}
    return x


def dati_scena(stile, seme):
    R, sguardi, inclinazioni, contentezza, battiti = componi_regia(seme)
    cam = componi_camera(R)
    sentiero, _ = ricampiona(curva(SENTIERO), 0.06)
    dati = dict(
        titolo=TITOLO,
        stile=stile,
        seme=seme,
        tracciato=dict(dt=R.dt, x=R.c["x"], z=R.c["z"], dir=R.c["dir"], passo=R.c["passo"], peso=R.c["peso"]),
        camera=cam,
        eventi=R.eventi,
        tempi=TEMPI,
        sguardi=sguardi,
        inclinazioni=inclinazioni,
        contentezza=contentezza,
        battiti=battiti,
        falcata=FALCATA,
        sentiero=dict(punti=sentiero, larghezza=LARGHEZZA_SENTIERO),
        papera=PAPERA,
        limone=LIMONE,
        ambiente=AMBIENTE,
        fumetto=dict(FUMETTO, righe=NUVOLETTA, evidenzia=PAROLA_IN_GIALLO),
        pixel=PIXEL,
    )
    return arrotonda(dati)


# ═══════════════════════════ Pagina ═══════════════════════════

CSS = """
:root { --cielo: __CIELO__; color-scheme: light; }
html, body { height: 100%; margin: 0; background: var(--cielo); overflow: hidden; }
#scena, #fumetto { position: fixed; inset: 0; width: 100%; height: 100%; display: block; }
#fumetto { pointer-events: none; }
#scena.pixel, #fumetto.pixel { image-rendering: pixelated; image-rendering: crisp-edges; }
#velo { position: fixed; inset: 0; background: var(--cielo); pointer-events: none; }
"""


def font_face(nome, file):
    dati = base64.b64encode((QUI / "font" / file).read_bytes()).decode("ascii")
    return (f'@font-face {{ font-family: "{nome}"; src: url(data:font/woff2;base64,{dati}) format("woff2"); '
            f'font-display: block; }}')


def componi_pagina(dati, frammento, three):
    stile = dati["stile"]
    css = CSS.replace("__CIELO__", AMBIENTE["orizzonte"])
    if stile == "pixel":
        css = font_face(FUMETTO["font_pixel"], "pixelify-sans-latin-500-normal.woff2") + "\n" + css
    else:
        css = font_face(FUMETTO["font_morbido"], "gaegu-latin-700-normal.woff2") + "\n" + css
    if three:
        script_three = "<script>\n" + Path(three).read_text(encoding="utf-8") + "\n</script>"
    else:
        script_three = '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>'
    renderer = (QUI / "renderer.js").read_text(encoding="utf-8")
    js_dati = json.dumps(dati, ensure_ascii=False, separators=(",", ":"))
    corpo = ('<canvas id="scena" aria-label="Una papera porta un limone"></canvas>\n'
             '<canvas id="fumetto" aria-hidden="true"></canvas>\n'
             '<div id="velo"></div>')
    script = (f"{script_three}\n<script>window.__DATI__ = {js_dati};</script>\n"
              f"<script>\n{renderer}\n</script>")
    if frammento:
        return f"<title>{dati['titolo']}</title>\n<style>{css}</style>\n{corpo}\n{script}\n"
    tpl = (QUI / "template.html").read_text(encoding="utf-8")
    return (tpl.replace("__TITOLO__", dati["titolo"])
               .replace("__STILE__", css)
               .replace("__CORPO__", corpo)
               .replace("__SCRIPT__", script))


def main():
    ap = argparse.ArgumentParser(description="Genera la pagina della papera col limone.")
    ap.add_argument("-o", "--uscita", default="index.html", help="file da scrivere (default: index.html)")
    ap.add_argument("--stile", choices=["morbido", "pixel"], default=STILE)
    ap.add_argument("--seed", type=int, default=SEME)
    ap.add_argument("--three", help="percorso di three.min.js da incorporare nella pagina")
    ap.add_argument("--frammento", action="store_true", help="senza <html>/<head>, per claude.ai")
    ap.add_argument("--json", help="scrive anche i dati di regia in questo file")
    ap.add_argument("--titolo", help="nome della scheda del browser (altrimenti TITOLO)")
    a = ap.parse_args()

    dati = dati_scena(a.stile, a.seed)
    if a.titolo:
        dati["titolo"] = a.titolo
    if a.json:
        Path(a.json).write_text(json.dumps(dati, ensure_ascii=False, indent=1), encoding="utf-8")
    html = componi_pagina(dati, a.frammento, a.three)
    Path(a.uscita).write_text(html, encoding="utf-8")
    ev = dati["eventi"]
    print(f"scritto {a.uscita} ({len(html) / 1024:.0f} KB) · stile {a.stile} · "
          f"presa a {ev['presa']:.1f}s · arrivo a {ev['arrivata']:.1f}s · nuvoletta a {ev['nuvoletta']:.1f}s")


if __name__ == "__main__":
    main()
