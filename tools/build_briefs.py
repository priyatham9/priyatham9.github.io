#!/usr/bin/env python3
"""Build the plain-language briefs (English and Spanish) into briefs/.

Figures are written as {id} placeholders; each one is filled from the committed
repository outputs named in briefs/numbers.json. Run: python3 tools/build_briefs.py
"""

import html
import os
import re

import briefs_numbers as bn

SITE = "https://priyatham9.github.io/briefs/"
UPDATED = "2026-10-27"

PAGES = {}

# ---------------------------------------------------------------- brief A
PAGES["small-workplace-rates"] = {
    "en": {
        "title": "Why injury rates at small workplaces jump around",
        "desc": "A one-page plain-language brief: at small workplaces one injury, or none, swings the injury rate, so a single year's rate says little.",
        "short": "At a small workplace, one injury more or less changes the injury rate a lot. A rate from one year is a weak way to say whether a small workplace is safe or unsafe.",
        "sections": [
            ("What the numbers show", [
                "<b>Many small workplaces report no injuries at all.</b> In OSHA's public injury files, {a_zero_small} of the workplace-years in the smallest size group ({a_band_small} employees) reported zero cases. In the largest group ({a_band_large} employees) it was {a_zero_large}. A zero can mean a safe year. It can also mean a few lucky months.",
                "<b>One injury moves the rate a lot.</b> Take chemical plants with {a_chem_small} employees. The middle plant works {a_hours_small} hours in a year. For that plant, one more injury raises the rate by {a_swing_small} points. For a plant with {a_chem_large} employees, one more injury raises it by only {a_swing_large} points.",
                "<b>The order changes from year to year.</b> Researchers measure this with a score. A score of one means plants keep the same order every year. A score of zero means last year's order tells you nothing. For chemical plants with {a_chem_small} employees the score is {a_rho_small}. For plants with {a_chem_large} employees it is {a_rho_large}.",
            ]),
            ("What this means for you", [
                "<b>Workers:</b> a low or high rate at a small workplace is not proof about your own risk. Ask about the hazards you work near: machines, chemicals, lifting, heat. Ask what the employer fixed after past injuries or near misses.",
                "<b>Small employers:</b> do not take comfort from a year with no injuries, and do not panic over a bad year. Look at several years together. Count near misses and hazards reported by workers. These show problems before someone is hurt.",
                "<b>Anyone comparing workplaces:</b> do not rank small workplaces by one year's rate.",
            ]),
        ],
        "limits": "The zero-case shares come from OSHA establishment filings in all industries. The one-injury swing and year-to-year scores come from chemical manufacturing plants only. The data are reported by employers and have errors. These results describe patterns in groups of workplaces, not any one workplace.",
    },
    "es": {
        "title": "Por qué las tasas de lesiones en lugares de trabajo pequeños cambian tanto",
        "desc": "Resumen de una página en lenguaje sencillo: en un lugar de trabajo pequeño, una lesión más o menos cambia mucho la tasa de lesiones.",
        "short": "En un lugar de trabajo pequeño, una lesión más o menos cambia mucho la tasa de lesiones. La tasa de un solo año no sirve mucho para decir si un lugar pequeño es seguro o peligroso.",
        "sections": [
            ("Lo que muestran los números", [
                "<b>Muchos lugares de trabajo pequeños no reportan ninguna lesión.</b> En los archivos públicos de OSHA, el {a_zero_small} de los años de trabajo del grupo más pequeño ({a_band_small} empleados) reportó cero casos. En el grupo más grande ({a_band_large} empleados) fue el {a_zero_large}. Un cero puede significar un año seguro. También puede significar unos meses con suerte.",
                "<b>Una sola lesión mueve mucho la tasa.</b> Tomemos las plantas químicas con {a_chem_small} empleados. La planta del medio trabaja {a_hours_small} horas al año. En esa planta, una lesión más sube la tasa {a_swing_small} puntos. En una planta con {a_chem_large} empleados, una lesión más sube la tasa solo {a_swing_large} puntos.",
                "<b>El orden cambia de un año a otro.</b> Los investigadores lo miden con una calificación. Una calificación de uno significa que las plantas mantienen el mismo orden cada año. Una calificación de cero significa que el orden del año pasado no dice nada. En las plantas químicas con {a_chem_small} empleados la calificación es {a_rho_small}. En las plantas con {a_chem_large} empleados es {a_rho_large}.",
            ]),
            ("Qué significa para usted", [
                "<b>Trabajadores:</b> una tasa baja o alta en un lugar pequeño no prueba nada sobre su propio riesgo. Pregunte por los peligros cerca de su trabajo: máquinas, químicos, cargar peso, calor. Pregunte qué arregló el empleador después de lesiones o casi accidentes anteriores.",
                "<b>Empleadores pequeños:</b> no se tranquilice por un año sin lesiones y no se alarme por un mal año. Mire varios años juntos. Cuente los casi accidentes y los peligros que reportan los trabajadores. Muestran los problemas antes de que alguien se lastime.",
                "<b>Cualquier persona que compare lugares de trabajo:</b> no ordene los lugares pequeños por la tasa de un solo año.",
            ]),
        ],
        "limits": "Los porcentajes de cero casos vienen de los registros de establecimientos de OSHA en todas las industrias. El cambio por una lesión y las calificaciones de un año a otro vienen solo de plantas de fabricación química. Los datos los reportan los empleadores y tienen errores. Estos resultados describen patrones en grupos de lugares de trabajo, no un lugar en particular.",
    },
}

# ---------------------------------------------------------------- brief B
PAGES["implausible-hours"] = {
    "en": {
        "title": "What impossible hours do to the national injury rate",
        "desc": "A one-page plain-language brief: a few filings with impossible hours worked make the national injury rate look about thirty times too low.",
        "short": "An injury rate is injuries divided by hours worked. A few filings with impossible hours worked can make the national rate look far too low.",
        "sections": [
            ("What the numbers show", [
                "<b>A few bad filings hold almost all the hours.</b> We read {b_filings} injury filings that employers sent to OSHA. Of these, {b_bad} ({b_bad_share}) reported hours per employee outside a plausible range, below {b_min_hours} or above {b_max_hours} hours a year. Those filings hold {b_bad_hours} of all the hours reported. They hold only {b_bad_cases} of the injury cases.",
                "<b>One filing is enough.</b> The single filing with the most hours holds {b_top1} of all hours reported.",
                "<b>The rate changes about thirty times.</b> With every filing included, the national rate comes out at {b_trir_raw} injuries per {b_unit} hours worked, which would be an extremely safe country. After setting aside the implausible filings, it is {b_trir_fix}. The second is {b_ratio} times the first.",
                "<b>The choice of limits is not the cause.</b> We tried {b_grid_count} different pairs of limits. The correction stayed between {b_grid_min} and {b_grid_max} times in every case.",
            ]),
            ("What this means for you", [
                "<b>Workers and worker groups:</b> if you see a very low national injury rate, check how it was made. A rate built from all filings, without checking the hours, can look much safer than the country really is.",
                "<b>Small employers:</b> check the hours you report. A typing mistake in hours, such as extra zeros, does not only affect your own record. It can change the numbers others use to compare workplaces.",
                "<b>Anyone using the public data:</b> check hours per employee before you calculate a rate.",
            ]),
        ],
        "limits": "The limits for a plausible filing are a choice made in this analysis, not an OSHA rule. We cannot know which filings are typing mistakes and which are true. The data are reported by employers. This brief covers the filings in the OSHA files we read, not every workplace.",
    },
    "es": {
        "title": "Qué hacen las horas imposibles a la tasa nacional de lesiones",
        "desc": "Resumen de una página en lenguaje sencillo: unos pocos registros con horas imposibles hacen que la tasa nacional de lesiones parezca unas treinta veces menor.",
        "short": "La tasa de lesiones es el número de lesiones dividido entre las horas trabajadas. Unos pocos registros con horas imposibles pueden hacer que la tasa nacional parezca mucho más baja de lo real.",
        "sections": [
            ("Lo que muestran los números", [
                "<b>Unos pocos registros malos tienen casi todas las horas.</b> Leímos {b_filings} registros de lesiones que los empleadores enviaron a OSHA. De ellos, {b_bad} ({b_bad_share}) reportaron horas por empleado fuera de un rango posible: menos de {b_min_hours} o más de {b_max_hours} horas al año. Esos registros tienen el {b_bad_hours} de todas las horas reportadas. Solo tienen el {b_bad_cases} de los casos de lesiones.",
                "<b>Un solo registro basta.</b> El único registro con más horas tiene el {b_top1} de todas las horas reportadas.",
                "<b>La tasa cambia unas treinta veces.</b> Si se incluyen todos los registros, la tasa nacional es {b_trir_raw} lesiones por cada {b_unit} horas trabajadas, lo que sería un país extremadamente seguro. Si se dejan aparte los registros imposibles, es {b_trir_fix}. La segunda cifra es {b_ratio} veces la primera.",
                "<b>Los límites que elegimos no son la causa.</b> Probamos {b_grid_count} pares de límites distintos. La corrección se mantuvo entre {b_grid_min} y {b_grid_max} veces en todos los casos.",
            ]),
            ("Qué significa para usted", [
                "<b>Trabajadores y grupos de trabajadores:</b> si ve una tasa nacional de lesiones muy baja, revise cómo se calculó. Una tasa hecha con todos los registros, sin revisar las horas, puede parecer mucho más segura de lo que es el país.",
                "<b>Empleadores pequeños:</b> revise las horas que reporta. Un error al escribir las horas, como ceros de más, no solo afecta su propio registro. También puede cambiar los números que otros usan para comparar lugares de trabajo.",
                "<b>Cualquier persona que use los datos públicos:</b> revise las horas por empleado antes de calcular una tasa.",
            ]),
        ],
        "limits": "Los límites de un registro posible son una decisión de este análisis, no una regla de OSHA. No podemos saber cuáles registros son errores de escritura y cuáles son ciertos. Los datos los reportan los empleadores. Este resumen cubre los registros de los archivos de OSHA que leímos, no todos los lugares de trabajo.",
    },
}

# ---------------------------------------------------------------- brief C
PAGES["low-rate-chemical-risk"] = {
    "en": {
        "title": "A low injury rate does not mean a low chemical release risk",
        "desc": "A one-page plain-language brief: at chemical plants, the injury rate says little about the risk of a chemical release; release history and the amount of chemicals held say more.",
        "short": "Injury rates count injuries to workers. A chemical release is a different kind of event, and a low injury rate does not tell you much about it.",
        "sections": [
            ("What the numbers show", [
                "<b>Serious injuries happen behind clean records.</b> We looked at {c_total} serious injuries at chemical plants where the plant's record for the year before was available. In {c_zero} of them ({c_zero_pct}), the plant had reported zero injuries the year before.",
                "<b>The injury rate did not predict releases.</b> Among plants with {c_size} employees, plants with a lower injury rate had a reportable chemical release the next year in {c_below} of plant-years. Plants with a higher rate: {c_above}. These are about the same.",
                "<b>Release history did.</b> A plant with a reportable release in the past five years had another the next year in {c_hist} of plant-years. A plant without one: {c_nohist}. That is {c_ratio} times as often.",
                "<b>The amount of chemicals held did too.</b> Plants in the {c_inv_bigband} group of regulated chemicals held had a release the next year in {c_inv_big} of plant-years. Plants in the {c_inv_smallband} group: {c_inv_small}.",
            ]),
            ("What this means for you", [
                "<b>Workers:</b> a good injury record at a chemical plant does not show that the chemicals are well controlled. You can ask about past releases, the chemicals stored, and the emergency plan.",
                "<b>Small employers:</b> track chemical releases and near misses separately from injuries. Your injury count will not warn you about them.",
                "<b>Neighbors and community groups:</b> EPA release histories and chemical inventories are public. They say more about release risk than the injury rate.",
            ]),
        ],
        "limits": "These results are for chemical manufacturing plants in the United States, among {c_plants} plants linked from public records. They are patterns in reported data. They do not show causes, and they are not a rating of any one plant. Serious injuries are counted only in states where federal OSHA covers private employers.",
    },
    "es": {
        "title": "Una tasa baja de lesiones no significa poco riesgo de escape de químicos",
        "desc": "Resumen de una página en lenguaje sencillo: en las plantas químicas, la tasa de lesiones dice poco sobre el riesgo de un escape de químicos; el historial de escapes y la cantidad de químicos almacenados dicen más.",
        "short": "La tasa de lesiones cuenta las lesiones de los trabajadores. Un escape de químicos es otro tipo de suceso, y una tasa baja de lesiones dice poco sobre él.",
        "sections": [
            ("Lo que muestran los números", [
                "<b>Las lesiones graves ocurren en lugares con buen registro.</b> Revisamos {c_total} lesiones graves en plantas químicas donde se conocía el registro del año anterior. En {c_zero} de ellas ({c_zero_pct}), la planta había reportado cero lesiones el año anterior.",
                "<b>La tasa de lesiones no anticipó los escapes.</b> Entre las plantas de {c_size} empleados, las que tenían una tasa de lesiones más baja tuvieron un escape de químicos reportable al año siguiente en el {c_below} de los años-planta. Las que tenían una tasa más alta: {c_above}. Es casi lo mismo.",
                "<b>El historial de escapes sí.</b> Una planta con un escape reportable en los últimos cinco años tuvo otro al año siguiente en el {c_hist} de los años-planta. Una planta sin escapes previos: {c_nohist}. Eso es {c_ratio} veces más seguido.",
                "<b>La cantidad de químicos almacenados también.</b> Las plantas del grupo {c_inv_bigband} de químicos regulados almacenados (lb = libras) tuvieron un escape al año siguiente en el {c_inv_big} de los años-planta. Las plantas del grupo {c_inv_smallband}: {c_inv_small}.",
            ]),
            ("Qué significa para usted", [
                "<b>Trabajadores:</b> un buen registro de lesiones en una planta química no muestra que los químicos estén bien controlados. Puede preguntar por escapes anteriores, por los químicos almacenados y por el plan de emergencia.",
                "<b>Empleadores pequeños:</b> lleve la cuenta de los escapes de químicos y de los casi accidentes por separado de las lesiones. Su cuenta de lesiones no le avisará de ellos.",
                "<b>Vecinos y grupos comunitarios:</b> los historiales de escapes y los inventarios de químicos de la EPA son públicos. Dicen más sobre el riesgo de escape que la tasa de lesiones.",
            ]),
        ],
        "limits": "Estos resultados son de plantas de fabricación química en Estados Unidos, entre {c_plants} plantas unidas a partir de registros públicos. Son patrones en datos reportados. No muestran causas y no son una calificación de ninguna planta en particular. Las lesiones graves se cuentan solo en los estados donde OSHA federal cubre a los empleadores privados.",
    },
}


# ---------------------------------------------------------------- rendering
UI = {
    "en": {
        "lang": "en", "back": "All briefs", "other": "Español", "short_label": "The short answer",
        "src_h": "Where each number comes from", "src_sub": "Each number is copied from a file in a public repository. The link opens that file.",
        "col_n": "Number", "col_s": "Source file", "col_c": "Field",
        "note": "Independent research by Priyatham Chimmani. Not legal advice and not an OSHA or EPA publication.",
        "limits_h": "Limits", "updated": "Updated", "kind": "Plain-language brief",
        "tr_note": "A Spanish translation of this brief is available.",
    },
    "es": {
        "lang": "es", "back": "Todos los resúmenes", "other": "English", "short_label": "La respuesta corta",
        "src_h": "De dónde viene cada número", "src_sub": "Cada número se copió de un archivo de un repositorio público. El enlace abre ese archivo.",
        "col_n": "Número", "col_s": "Archivo de origen", "col_c": "Campo",
        "note": "Investigación independiente de Priyatham Chimmani. No es asesoría legal ni una publicación de OSHA o de la EPA.",
        "limits_h": "Límites", "updated": "Actualizado", "kind": "Resumen en lenguaje sencillo",
        "tr_note": "Esta página es una traducción al español del resumen en inglés. Si hay alguna diferencia, vale la versión en inglés.",
    },
}

CSS = """
:root{--paper:#F7F7F3;--surface:#FFFFFF;--surface-2:#EFEFE9;--ink:#101311;--ink-2:#3A403C;--muted:#5C635E;--rule:#101311;--rule-soft:#D6D7CE;--accent:#0B5C3E;--accent-ink:#FFFFFF;--wash:#E3F0E9;--warn:#7A3D00;--warn-wash:#F6E8D8;--font-sans:"Archivo",ui-sans-serif,system-ui,sans-serif;--font-mono:"IBM Plex Mono",ui-monospace,Menlo,Consolas,monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--paper:#0A0D0B;--surface:#121712;--surface-2:#171D18;--ink:#EAEFEA;--ink-2:#BFC7C1;--muted:#9AA39D;--rule:#EAEFEA;--rule-soft:#262E28;--accent:#3FCB88;--accent-ink:#06130C;--wash:#10241A;--warn:#E09B4C;--warn-wash:#2A2013}}
:root[data-theme="dark"]{--paper:#0A0D0B;--surface:#121712;--surface-2:#171D18;--ink:#EAEFEA;--ink-2:#BFC7C1;--muted:#9AA39D;--rule:#EAEFEA;--rule-soft:#262E28;--accent:#3FCB88;--accent-ink:#06130C;--wash:#10241A;--warn:#E09B4C;--warn-wash:#2A2013}
*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--font-sans);font-size:1.0625rem;line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:var(--accent)}a:hover{text-decoration:none}
:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.wrap{max-width:760px;margin:0 auto;padding:0 16px}
.skip{position:absolute;left:-999px;top:8px;background:var(--accent);color:var(--accent-ink);padding:10px 14px;z-index:100}.skip:focus{left:8px}
.topbar{border-bottom:2px solid var(--rule)}
.topbar .wrap{display:flex;justify-content:space-between;align-items:center;gap:12px;padding-top:12px;padding-bottom:12px;flex-wrap:wrap}
.topbar a{font-family:var(--font-mono);font-size:.8125rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;min-height:44px;display:inline-flex;align-items:center}
h1{font-size:clamp(1.6rem,5vw,2.3rem);line-height:1.12;margin:28px 0 8px;letter-spacing:-.01em}
h2{font-size:1.2rem;margin:26px 0 8px;line-height:1.25}
.label{font-family:var(--font-mono);font-size:.75rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:600}
.short{background:var(--wash);border-left:5px solid var(--accent);padding:14px 16px;margin:18px 0}
.short .label{display:block;margin-bottom:4px;color:var(--accent)}
.tr{background:var(--warn-wash);color:var(--ink);border:2px solid var(--warn);padding:10px 14px;margin:16px 0;font-size:.9375rem}
ul.pts{padding-left:1.2em;margin:0}ul.pts li{margin-bottom:10px}
.num{font-family:var(--font-mono);font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
.limits{color:var(--ink-2);font-size:.9375rem}
table{width:100%;border-collapse:collapse;border:2px solid var(--rule);background:var(--surface);font-size:.875rem}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--rule-soft);vertical-align:top}
th{font-family:var(--font-mono);font-size:.6875rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);background:var(--surface-2)}
td a{overflow-wrap:anywhere}
.sub{color:var(--ink-2);font-size:.9375rem;margin:0 0 10px}
.foot{padding:26px 0 44px;color:var(--muted);font-size:.875rem}
.cards a{display:block;border:2px solid var(--rule);background:var(--surface);padding:14px 16px;margin-bottom:12px;color:var(--ink);text-decoration:none}
.cards a:hover{border-color:var(--accent)}
@media (max-width:560px){table,tbody,tr,td{display:block}thead{position:absolute;left:-999px}tr{border-bottom:2px solid var(--rule-soft);padding:6px 0}td{border:0;padding:3px 10px}}
@media print{@page{margin:12mm}body{font-size:10pt;line-height:1.4}.topbar,.foot .btn{display:none}table{font-size:8pt}h1{font-size:18pt;margin-top:8pt}h2{margin-top:10pt}.short{margin:8pt 0}}
"""

HEAD_LINKS = (
    '<link rel="preconnect" href="https://fonts.googleapis.com" />'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />'
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;800&amp;'
    'family=IBM+Plex+Mono:wght@500;600;700&amp;display=swap" />'
)

THEME_JS = """(function(){try{var s=localStorage.getItem("pc-theme");if(s==="dark"||s==="light")document.documentElement.setAttribute("data-theme",s)}catch(e){}})();"""


def esc(s):
    return html.escape(s, quote=True)


def fill(text, manifest, used):
    def sub(match):
        key = match.group(1)
        entry = manifest["numbers"][key]
        used.append(key)
        return f'<span class="num" data-num="{key}">{esc(bn.display(entry))}</span>'
    return re.sub(r"\{([a-z]_[a-z0-9_]+)\}", sub, text)


def field_name(entry):
    if "csv" in entry:
        return entry["csv"]["col"]
    if "json" in entry:
        return " / ".join(k for k in entry["json"] if isinstance(k, str))
    return "README"


def page_shell(lang, title, desc, path_en, path_es, body, self_url):
    ui = UI[lang]
    return f"""<!doctype html>
<html lang="{ui['lang']}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc)}" />
<meta name="author" content="Priyatham Chimmani" />
<meta name="color-scheme" content="light dark" />
<link rel="canonical" href="{self_url}" />
{f'<link rel="alternate" hreflang="en" href="{SITE}{path_en}" /><link rel="alternate" hreflang="es" href="{SITE}{path_es}" />' if path_es else ''}
<meta property="og:type" content="article" />
<meta property="og:title" content="{esc(title)}" />
<meta property="og:description" content="{esc(desc)}" />
<meta property="og:url" content="{self_url}" />
<meta property="og:image" content="https://priyatham9.github.io/og.png" />
{HEAD_LINKS}
<style>{CSS}</style>
<script>{THEME_JS}</script>
</head>
<body>
{body}
</body>
</html>
"""


def render_brief(slug, lang, manifest):
    page = PAGES[slug][lang]
    ui = UI[lang]
    other = "en" if lang == "es" else "es"
    used = []
    short = fill(page["short"], manifest, used)
    secs = ""
    for head, pts in page["sections"]:
        items = "".join(f"<li>{fill(p, manifest, used)}</li>" for p in pts)
        secs += f"<h2>{esc(head)}</h2><ul class=\"pts\">{items}</ul>"
    limits = fill(page["limits"], manifest, used)
    order = list(dict.fromkeys(used))
    rows = ""
    for key in order:
        e = manifest["numbers"][key]
        url = bn.source_url(manifest, e)
        rows += (
            f'<tr><td><span class="num" data-num="{key}">{esc(bn.display(e))}</span></td>'
            f'<td><a href="{url}">{esc(e["repo"])}/{esc(e["file"])}</a></td>'
            f'<td><code class="num">{esc(field_name(e))}</code></td></tr>'
        )
    here = "" if lang == "en" else "es/"
    en_path = f"{slug}/"
    es_path = f"{slug}/es/"
    self_url = SITE + (es_path if lang == "es" else en_path)
    other_href = "es/" if lang == "en" else "../"
    back = "../" if lang == "en" else "../../"
    notice = (
        f'<p class="tr" role="note" lang="{lang}">{esc(ui["tr_note"])} '
        f'<a href="{other_href}" hreflang="{other}" lang="{other}">{esc(UI[other]["other"])}</a></p>'
        if lang == "en"
        else f'<p class="tr" role="note"><strong>Traducción.</strong> {esc(ui["tr_note"])} '
             f'<a href="{other_href}" hreflang="en" lang="en">English</a></p>'
    )
    body = f"""<a class="skip" href="#main">{'Skip to content' if lang == 'en' else 'Ir al contenido'}</a>
<header class="topbar"><div class="wrap">
<a href="{back}">&larr; {esc(ui['back'])}</a>
<a href="{other_href}" hreflang="{other}" lang="{other}">{esc(UI[other]['other'])}</a>
</div></header>
<main id="main" class="wrap" tabindex="-1">
<p class="label" style="margin-top:24px">{esc(ui['kind'])} &middot; {esc(ui['updated'])} <time datetime="{UPDATED}">{UPDATED}</time></p>
<h1>{esc(page['title'])}</h1>
{notice}
<div class="short"><span class="label">{esc(ui['short_label'])}</span>{short}</div>
{secs}
<h2>{esc(ui['limits_h'])}</h2>
<p class="limits">{limits}</p>
<h2>{esc(ui['src_h'])}</h2>
<p class="sub">{esc(ui['src_sub'])}</p>
<table><thead><tr><th scope="col">{esc(ui['col_n'])}</th><th scope="col">{esc(ui['col_s'])}</th><th scope="col">{esc(ui['col_c'])}</th></tr></thead><tbody>{rows}</tbody></table>
</main>
<footer class="foot"><div class="wrap">{esc(ui['note'])}</div></footer>"""
    return page_shell(lang, page["title"] + " - Priyatham Chimmani", page["desc"], en_path, es_path, body, self_url)


def render_hub():
    cards = {"en": "", "es": ""}
    for lang in ("en", "es"):
        for slug, p in PAGES.items():
            href = f"{slug}/" if lang == "en" else f"{slug}/es/"
            cards[lang] += f'<a href="{href}"><strong>{esc(p[lang]["title"])}</strong><br /><span class="sub">{esc(p[lang]["short"])}</span></a>'
    body = f"""<a class="skip" href="#main">Skip to content</a>
<header class="topbar"><div class="wrap"><a href="../">&larr; Priyatham Chimmani</a></div></header>
<main id="main" class="wrap" tabindex="-1">
<p class="label" style="margin-top:24px">Plain-language briefs &middot; Resúmenes en lenguaje sencillo</p>
<h1>Findings briefs for workers and small employers</h1>
<p>One page each. Every number links to the public file it comes from. Each brief has a Spanish translation.</p>
<h2 lang="en">English</h2>
<div class="cards">{cards['en']}</div>
<h2 lang="es">Español</h2>
<p class="tr" role="note" lang="es"><strong>Traducción.</strong> Estas páginas son traducciones al español de los resúmenes en inglés. Si hay alguna diferencia, vale la versión en inglés.</p>
<div class="cards" lang="es">{cards['es']}</div>
</main>
<footer class="foot"><div class="wrap">{esc(UI['en']['note'])}</div></footer>"""
    return page_shell("en", "Findings briefs for workers and small employers - Priyatham Chimmani",
                      "One-page plain-language briefs in English and Spanish, with every number linked to its public source file.",
                      "", "", body, SITE)


def main():
    manifest = bn.load_manifest()
    out = os.path.join(bn.ROOT, "briefs")
    files = {os.path.join(out, "index.html"): render_hub()}
    for slug in PAGES:
        files[os.path.join(out, slug, "index.html")] = render_brief(slug, "en", manifest)
        files[os.path.join(out, slug, "es", "index.html")] = render_brief(slug, "es", manifest)
    for path, text in files.items():
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text)
    print(f"wrote {len(files)} pages")


if __name__ == "__main__":
    main()
