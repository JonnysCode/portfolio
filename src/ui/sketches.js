// ─────────────────────────────────────────────────────────────────────────────
// Pencil sketches — the charming placeholder "photo" of a journal entry that
// has no images yet: a little ink drawing on a watercolour wash, as if Jonny
// had sketched the piece into his field journal. Pure inline SVG.
//
//   sketchFor(entry) → '<svg …>' markup
// ─────────────────────────────────────────────────────────────────────────────

/** Watercolour wash colour per area. */
export const AREA_WASH = {
  glen: '#7f9c55',
  woodworking: '#c98a4b',
  code: '#7d8fc4',
  home: '#c9573f',
  interior: '#c47f62',
  bikes: '#5f97ad',
};

// shared defs: a wobbly pencil line and a bleeding watercolour edge
const DEFS = `<defs>
  <filter id="sk-pencil" x="-5%" y="-5%" width="110%" height="110%">
    <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="3" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="2.4"/>
  </filter>
  <filter id="sk-wash" x="-20%" y="-20%" width="140%" height="140%">
    <feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="3" seed="7" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="16" result="d"/>
    <feGaussianBlur in="d" stdDeviation="1.6"/>
  </filter>
</defs>`;

const ink = (body, w = 1.6) =>
  `<g filter="url(#sk-pencil)" fill="none" stroke="#3d2f22" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${body}</g>`;
const hatch = (body) => `<g fill="none" stroke="#3d2f22" stroke-width=".8" opacity=".45" stroke-linecap="round">${body}</g>`;

/** Parallel hatching strokes inside a box (cheap shading). */
function hatchBox(x, y, w, h, step = 4, slant = 6) {
  let d = '';
  for (let i = 0; i < w + slant; i += step) d += `M${x + i} ${y + h}l${-slant} ${-h}`;
  return `<clipPath id="hb${x}${y}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath><path clip-path="url(#hb${x}${y})" d="${d}"/>`;
}

const DRAW = {
  'dining-table': () =>
    ink(`<path d="M42 70l150-4 12 14-150 5z"/><path d="M54 85v40M190 81v40M68 84v30M180 80v30"/><path d="M54 92h136" opacity=".5"/>
      <path d="M26 64v-24c0-4 9-4 9 0v24M26 52h9M24 74l13-1 1 32M24 74v32"/>
      <path d="M210 62v-24c0-4 9-4 9 0v24M210 50h9M206 72l15-1v32M206 72l1 32"/>`) +
    hatch(`<path d="M60 86l8-6M80 86l8-6M100 85l8-6M120 85l8-6M140 84l8-6M160 83l8-6"/>`),
  'record-player': () =>
    ink(`<path d="M40 70l160-6 6 34-160 6z"/><path d="M46 104l160-6M46 104l-6-34"/><ellipse cx="112" cy="78" rx="48" ry="11"/><ellipse cx="112" cy="77" rx="9" ry="2.2"/>
      <path d="M176 66v8l-24 18 4 4"/><circle cx="176" cy="66" r="4"/><path d="M58 98h10M180 92h10"/>`) +
    hatch(`<path d="M76 79c14 5 58 6 74 0M84 74c12 3 44 3 56 0"/>`) +
    `<g fill="#3d2f22" opacity=".3"><text x="118" y="140" font-family="Patrick Hand, cursive" font-size="13">♪ ♫ ♪</text></g>`,
  'coffee-table': () =>
    ink(`<path d="M40 82l160-8 14 12-160 9z"/><path d="M54 95v22M200 86v22M66 93v16M190 86v16"/><path d="M54 106c40-3 100-6 146-10" opacity=".6"/>
      <path d="M96 76c0-6 10-6 10 0M98 76v-8c4-4 8-4 6 0"/><path d="M140 74l18-1 2 3-18 1z"/>`) +
    hatch(hatchBox(56, 96, 140, 8, 6, 4)),
  'record-cabinet': () =>
    ink(`<path d="M44 46h152v74H44z"/><path d="M120 46v74M44 58h152"/><path d="M52 126v6M188 126v6"/>
      <path d="M58 66v46M64 66v46M70 66v46M76 66v46M82 68v44M88 66v46"/><path d="M134 72h48v34h-48z"/><path d="M128 88v8"/>`) +
    hatch(hatchBox(134, 72, 48, 34, 5, 5)),
  'workbench-wip': () =>
    ink(`<path d="M30 70h176l-4 10H34z"/><path d="M44 80v46M192 80v46M44 112h148"/><path d="M30 70v10M206 70l-4 10"/>
      <path d="M44 64h22v6M50 58h10v6"/><path d="M118 62l48-4 2 5-48 4z"/><path d="M168 58l10-1"/><path d="M84 60l16-6M86 64l16-6"/>
      <circle cx="40" cy="96" r="4"/>`) +
    hatch(hatchBox(46, 84, 144, 24, 7, 4)),
  'efz-certificate': () =>
    ink(`<path d="M50 40c0-6 8-6 8 0v82c0 6-8 6-8 0"/><path d="M58 40h124c6 0 6 82 0 82H58"/><path d="M76 58h88M82 72h76M88 84h64M90 96h40"/>
      <circle cx="160" cy="104" r="11"/><path d="M154 113l-4 14 8-4 4 7 2-14M166 113l2 14"/>`) +
    `<circle cx="160" cy="104" r="9" fill="#b8432f" opacity=".55"/>`,
  'bike-build': () => bike(),
  'bike-restoration': () =>
    bike() + ink(`<path d="M190 34l22 22M206 50c4-4 10-2 10 4l-6 1-2 4c-6 0-8-6-4-10"/><path d="M186 30c-4 4-2 10 4 10l1-6 4-2c0-6-6-8-10-4"/>`, 1.4),
  'wheel-building': () => {
    let spokes = '';
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2, b = a + 0.5;
      spokes += `M${120 + Math.cos(a) * 8} ${82 + Math.sin(a) * 8}L${120 + Math.cos(b) * 50} ${82 + Math.sin(b) * 50}`;
    }
    return ink(`<circle cx="120" cy="82" r="54"/><circle cx="120" cy="82" r="49"/><circle cx="120" cy="82" r="8"/><path d="${spokes}" stroke-width=".9"/>
      <path d="M58 140h124M70 140l14-58M170 140l-14-58"/>`);
  },
  'living-room': () =>
    ink(`<path d="M48 84c0-12 4-16 16-16h92c12 0 16 4 16 16v6H48z"/><path d="M40 90c0-8 12-8 12 0v20h116V90c0-8 12-8 12 0v26H40z"/><path d="M48 116v8M172 116v8"/>
      <path d="M86 96c6-6 18-6 24 0M116 96c6-6 18-6 24 0"/><path d="M198 124V46M188 46h20l-4-14h-12z"/><path d="M192 124h12"/>
      <path d="M22 124c0-10 4-14 8-14s8 4 8 14z"/><path d="M30 110c-6-14-4-24 2-30M30 110c4-10 10-16 16-16M30 108c-8-6-14-8-18-6"/>`) +
    hatch(hatchBox(52, 92, 116, 16, 6, 5)),
  moodboards: () =>
    ink(`<path d="M36 30h168v100H36z"/><path d="M50 44h40v32H50zM100 40h44v26h-44zM154 46h38v38h-38zM56 86h34v32H56zM104 76h40v44h-40zM156 94h36v24h-36z"/>
      <circle cx="70" cy="44" r="2.4"/><circle cx="122" cy="40" r="2.4"/><circle cx="173" cy="46" r="2.4"/>`) +
    `<g opacity=".55"><rect x="51" y="45" width="38" height="30" fill="#c47f62"/><rect x="101" y="41" width="42" height="24" fill="#8a9a6a"/><rect x="155" y="47" width="36" height="36" fill="#d8c19a"/><rect x="57" y="87" width="32" height="30" fill="#6b4430"/><rect x="105" y="77" width="38" height="42" fill="#e3d6bd"/><rect x="157" y="95" width="34" height="22" fill="#5f97ad"/></g>`,
  'small-space': () =>
    ink(`<path d="M40 30h160v104H40z" stroke-width="2.6"/><path d="M118 30v52M40 82h50M118 104v30M150 82h50"/><path d="M90 82c0-12 10-22 22-22" stroke-dasharray="3 3"/>
      <path d="M50 40h30v18H50zM128 40h62v12h-62zM52 96h44v26H52zM160 92h30v34h-30zM128 118h18v10h-18z"/>`) +
    hatch(`<path d="M128 40l6 12M136 40l6 12M144 40l6 12M152 40l6 12M160 40l6 12M168 40l6 12M176 40l6 12"/>`),
  'this-portfolio': () =>
    ink(`<path d="M44 30h152v86H44z"/><path d="M30 126h180l-10-10H40z"/>
      <path d="M120 54c-16 0-28 9-28 20h56c0-11-12-20-28-20z"/><path d="M110 74v18h20V74"/><circle cx="108" cy="64" r="2.5"/><circle cx="126" cy="61" r="2"/><circle cx="134" cy="68" r="2"/>
      <path d="M62 52l-8 8 8 8M178 52l8 8-8 8"/>`) +
    `<path d="M120 54c-16 0-28 9-28 20h56c0-11-12-20-28-20z" fill="#c9573f" opacity=".45"/>`,
  'project-backend': () =>
    ink(`<path d="M70 26h100v108H70z"/><path d="M70 52h100M70 78h100M70 104h100"/><circle cx="82" cy="39" r="2.4"/><circle cx="82" cy="65" r="2.4"/><circle cx="82" cy="91" r="2.4"/><circle cx="82" cy="117" r="2.4"/>
      <path d="M100 39h56M100 65h40M100 91h50M100 117h30"/><path d="M170 52c18 0 22 10 22 22s-4 30 18 30"/>`),
  'project-side': () =>
    ink(`<path d="M100 30h24M106 30v30l-26 50c-3 7 1 12 8 12h48c7 0 11-5 8-12l-26-50V30"/><path d="M88 96h48"/>
      <circle cx="178" cy="62" r="18"/><circle cx="178" cy="62" r="6"/><path d="M178 38v6M178 80v6M154 62h6M196 62h6M161 45l4 4M191 75l4 4M161 79l4-4M191 49l4-4"/>`) +
    `<path d="M88 96l-8 14c-3 7 1 12 8 12h48c7 0 11-5 8-12l-8-14z" fill="#7d8fc4" opacity=".45"/>`,
  'about-me': () =>
    ink(`<path d="M120 22c-34 0-58 22-60 46 0 4 3 6 7 6h106c4 0 7-2 7-6-2-24-26-46-60-46z"/><path d="M84 74v52h72V74"/><path d="M110 126v-20c0-6 4-10 10-10s10 4 10 10v20"/>
      <path d="M92 86h12v12H92zM136 86h12v12h-12z"/><circle cx="98" cy="44" r="5"/><circle cx="130" cy="36" r="4"/><circle cx="146" cy="54" r="4.5"/><path d="M150 30v-14h8v10"/>
      <path d="M40 126h160"/>`) +
    `<path d="M120 22c-34 0-58 22-60 46 0 4 3 6 7 6h106c4 0 7-2 7-6-2-24-26-46-60-46z" fill="#c9573f" opacity=".5"/>`,
  contact: () =>
    ink(`<path d="M96 60c0-14 10-22 24-22s24 8 24 22v34H96z"/><path d="M96 60h48"/><path d="M120 94v42M108 136h24"/><path d="M144 54h18v-14h-6"/>
      <path d="M104 66l16 12 16-12" opacity=".7"/><path d="M168 82l26-10 8 18-26 10z"/><path d="M168 82l16 6 10-16"/>`) +
    `<path d="M162 40h-6v14h6" fill="#c9573f" opacity=".6"/>`,
};

function bike() {
  return ink(`<circle cx="68" cy="100" r="30"/><circle cx="172" cy="100" r="30"/><circle cx="68" cy="100" r="3"/><circle cx="172" cy="100" r="3"/>
    <path d="M68 100l30-46h56l18 46M98 54l22 46h-52M120 100l34-46"/><path d="M90 46h20M154 54l-6-16h16"/><path d="M114 100l6 6M120 100v-4"/>`);
}

const KIND_FALLBACK = {
  project: () => ink(`<path d="M50 120l120-90 14 14-120 90z"/><path d="M58 112l10 10M74 100l6 6M90 88l10 10M106 76l6 6M122 64l10 10"/><path d="M150 112l40-40 6 6-40 40-10 4z"/>`),
  note: () => ink(`<path d="M64 26h112v108H64z"/><path d="M76 48h88M76 64h88M76 80h70M76 96h80"/><path d="M58 36h12M58 56h12M58 76h12M58 96h12M58 116h12"/>`),
  credential: () => DRAW['efz-certificate'](),
  about: () => DRAW['about-me'](),
  contact: () => DRAW.contact(),
};

/** The ink sketch for an entry (falls back by kind). */
export function sketchFor(entry) {
  const draw = DRAW[entry?.id] ?? KIND_FALLBACK[entry?.kind] ?? KIND_FALLBACK.project;
  const wash = AREA_WASH[entry?.area] ?? AREA_WASH.glen;
  return `<svg class="sketch" viewBox="0 0 240 160" role="img" aria-label="Pencil sketch: ${escapeAttr(entry?.title ?? '')}">${DEFS}
    <ellipse cx="122" cy="84" rx="86" ry="52" fill="${wash}" opacity=".32" filter="url(#sk-wash)"/>
    <ellipse cx="100" cy="70" rx="40" ry="22" fill="${wash}" opacity=".18" filter="url(#sk-wash)"/>
    ${draw()}
  </svg>`;
}

function escapeAttr(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
