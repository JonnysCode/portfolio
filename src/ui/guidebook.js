// ─────────────────────────────────────────────────────────────────────────────
// The guidebook — the whole portfolio as a little printed book: who Jonny is,
// how to reach him, and every place of the glen with every piece in it (full
// text, cut lists, tags, links). It is also the complete, accessible fallback
// when WebGL is unavailable — nothing on the site is reachable ONLY in 3D.
//
//   renderGuidebook(ctx, { show3d, onShow(entryId), onVisit(spotId) }) → Element
// ─────────────────────────────────────────────────────────────────────────────
import { SPOTS } from '../world/layout.js';
import { h } from './dom.js';
import { icon, spotIcon } from './icons.js';
import { sketchFor } from './sketches.js';
import { presentEntry, mailAddress, showDrafts } from './draft.js';

export function renderGuidebook(ctx, { show3d = true, onShow, onVisit, linkFor, onCopyLink } = {}) {
  const { content } = ctx;
  const P = content.profile;
  const progress = ctx.interactions?.progress?.();
  const secrets = ctx.interactions?.secrets?.();
  const daySecrets = ctx.interactions?.secrets?.({ by: 'day' });
  // every daytime secret found, the night ones still waiting: a gentle hint
  const dayDone = !!daySecrets && daySecrets.total > 0 && daySecrets.found >= daySecrets.total && secrets.found < secrets.total;

  const mail = mailAddress(P);
  const contact = h(
    'div',
    { class: 'guide__contact' },
    mail && h('a', { class: `stamp-btn is-primary${mail.draft ? ' is-draft' : ''}`, href: `mailto:${mail.email}` }, h('span', { html: icon('mail') }), 'Write me'),
    (P.links ?? []).map((l) => h('a', { class: 'stamp-btn', href: l.href, target: '_blank', rel: 'noopener' }, h('span', { html: icon(l.icon === 'github' ? 'github' : 'link') }), l.label)),
  );

  const toc = h(
    'nav',
    { class: 'guide__toc', 'aria-label': 'Places in the glen' },
    h('ol', {}, SPOTS.map((s) => h('li', {}, h('a', { href: `#guide-${s.id}`, onclick: (e) => { e.preventDefault(); document.getElementById(`guide-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, h('span', { class: 'guide__tocicon', html: spotIcon(s.id) }), content.areas[s.id]?.title ?? s.title)))),
  );

  const sections = SPOTS.map((s) => {
    const info = content.areas[s.id];
    const list = content.entriesForArea(s.id).sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));
    return h(
      'section',
      { class: 'guide__area', id: `guide-${s.id}`, 'aria-labelledby': `guide-h-${s.id}` },
      h(
        'header',
        { class: 'guide__areahead' },
        h('span', { class: 'guide__areaicon', html: spotIcon(s.id) }),
        h('div', {}, h('div', { class: 'guide__kicker' }, info?.kicker ?? s.subtitle), h('h3', { id: `guide-h-${s.id}`, class: 'guide__areatitle' }, info?.title ?? s.title)),
        show3d && h('button', { type: 'button', class: 'guide__visit', onclick: () => onVisit?.(s.id) }, 'Go there ', h('span', { html: icon('right') })),
      ),
      info?.text && h('p', { class: 'guide__areatext' }, info.text),
      list.length > 0 && h('div', { class: 'guide__entries' }, list.map((e) => entryCard(e))),
    );
  });

  function entryCard(e) {
    const visited = ctx.interactions?.isVisited?.(e.id);
    const shown = presentEntry(e);
    const meta = [e.subtitle, shown.year && !shown.yearDraft ? shown.year : null].filter(Boolean).join(' · ');
    const link = linkFor?.(e.id);
    // (an entry with no body yet shows its summary as the page: not twice here)
    const more = [
      shown.body.filter((p) => p.text !== e.summary).map((p) => h('p', { class: p.draft ? 'is-draft' : null }, p.text)),
      shown.facts.length > 0 && h('dl', { class: 'guide__facts' }, shown.facts.flatMap(([k, v, draft]) => [h('dt', { class: draft ? 'is-draft' : null }, k), h('dd', { class: draft ? 'is-draft' : null }, v)])),
      e.tags?.length && h('ul', { class: 'journal__tags' }, e.tags.map((t) => h('li', { class: 'paper-tag' }, t))),
      e.kind === 'contact' && contact.cloneNode(true),
      e.links?.length && h('div', { class: 'journal__links' }, e.links.map((l) => h('a', { class: 'stamp-btn', href: l.href, target: '_blank', rel: 'noopener' }, h('span', { html: icon('link') }), l.label))),
    ].flat().filter(Boolean);
    return h(
      'article',
      { class: `guide__entry${e.featured ? ' is-featured' : ''}`, 'aria-labelledby': `guide-e-${e.id}` },
      h('div', { class: 'guide__thumb', html: e.images?.length ? '' : sketchFor(e) }, e.images?.length ? h('img', { src: e.images[0].src, alt: e.images[0].alt ?? '', loading: 'lazy' }) : null),
      h(
        'div',
        { class: 'guide__entrytext' },
        h('h4', { id: `guide-e-${e.id}` }, e.title, visited && h('span', { class: 'guide__leaf', title: 'In your journal', html: icon('leaf') })),
        meta && h('p', { class: 'guide__meta' }, meta, shown.yearDraft && showDrafts ? h('span', { class: 'guide__draft' }, 'year: draft') : null),
        e.summary && h('p', { class: 'guide__summary' }, e.summary),
        more.length > 0 && h('details', { class: 'guide__more' }, h('summary', {}, 'Read the whole page'), more),
        show3d &&
          h(
            'div',
            { class: 'guide__actions' },
            h('button', { type: 'button', class: 'guide__show', onclick: () => onShow?.(e.id) }, 'Show me in the woodland ', h('span', { html: icon('right') })),
            link && h('a', { class: 'guide__copy', href: link, title: 'A link straight to this page of the journal', onclick: (ev) => { ev.preventDefault(); onCopyLink?.(link, e); } }, h('span', { html: icon('link') }), 'copy link'),
          ),
      ),
    );
  }

  return h(
    'div',
    { class: `guide${showDrafts ? ' shows-drafts' : ''}` },
    h(
      'header',
      { class: 'guide__cover' },
      h('div', { class: 'guide__kicker' }, 'The Guidebook'),
      h('h2', { id: 'modal-title', class: 'guide__title' }, `${P.name}’s Woodland`),
      h('p', { class: 'guide__tagline' }, P.tagline),
      h('p', { class: 'guide__intro' }, P.intro),
      contact,
      show3d && progress && h('p', { class: 'guide__progress' }, h('span', { html: icon('leaf') }), `${progress.visited} of ${progress.total} stories read`, secrets?.total ? [h('span', { class: 'guide__sep' }, '·'), h('span', { html: icon('sparkle') }), `${secrets.found} of ${secrets.total} secrets found`, dayDone ? h('span', { class: 'guide__hint' }, ' — some things only show themselves after dark (N)') : null] : null),
    ),
    toc,
    sections,
    h('footer', { class: 'guide__foot' }, h('p', {}, 'Every mushroom, plank and snail in this woodland is generated in code — no 3D models, no textures. ', P.location ? `Made in ${P.location}.` : '')),
  );
}
