// ─────────────────────────────────────────────────────────────────────────────
// The guidebook — the whole portfolio as a little printed book: who Jonny is,
// how to reach him, and every place of the glen with every piece in it (full
// text, cut lists, tags, links). It is also the complete, accessible fallback
// when WebGL is unavailable — nothing on the site is reachable ONLY in 3D.
//
//   renderGuidebook(ctx, { show3d, onShow(entryId), onVisit(spotId), polaroids }) → Element
// Each card's thumbnail is the owner's first photo — or, with the 3D glen
// running, a live polaroid of the piece (taken once a card scrolls into view,
// the pencil sketch until then). "Read the whole page" only folds away real
// words: a card whose page holds nothing beyond its summary shows its tags inline.
// ─────────────────────────────────────────────────────────────────────────────
import { SPOTS } from '../world/layout.js';
import { h } from './dom.js';
import { icon, spotIcon } from './icons.js';
import { sketchFor } from './sketches.js';
import { presentEntry, reachOut, showDrafts, withoutMailPromise } from './draft.js';

const LINK_ICON = { github: 'github', linkedin: 'linkedin' };

export function renderGuidebook(ctx, { show3d = true, onShow, onVisit, linkFor, onCopyLink, polaroids = null } = {}) {
  const { content } = ctx;
  const P = content.profile;
  let io = null; // (live polaroid thumbnails: taken as their cards scroll into view)
  const waiting = new Map();
  const progress = ctx.interactions?.progress?.();
  const secrets = ctx.interactions?.secrets?.();
  const daySecrets = ctx.interactions?.secrets?.({ by: 'day' });
  // every daytime secret found, the night ones still waiting: a gentle hint
  const dayDone = !!daySecrets && daySecrets.total > 0 && daySecrets.found >= daySecrets.total && secrets.found < secrets.total;

  // a letter only with a real address; otherwise the strongest link leads ("Find me on GitHub")
  const reach = reachOut(P);
  const mail = reach.mail;
  const linkBtn = (l, primary) =>
    h('a', { class: `stamp-btn${primary ? ' is-primary' : ''}`, href: l.href, target: '_blank', rel: 'noopener' }, h('span', { html: icon(LINK_ICON[l.icon] ?? 'link') }), primary ? `Find me on ${l.label}` : l.label);
  const contact = h(
    'div',
    { class: 'guide__contact' },
    mail && h('a', { class: `stamp-btn is-primary${mail.draft ? ' is-draft' : ''}`, href: `mailto:${mail.email}` }, h('span', { html: icon('mail') }), 'Write me'),
    reach.primary && linkBtn(reach.primary, true),
    reach.others.map((l) => linkBtn(l, false)),
  );

  // (no address to write to: the owner's words never promise a letter — "… and the mailbox is always open")
  const areaText = (text) => (text && !mail ? withoutMailPromise(text) : text);

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
      areaText(info?.text) && h('p', { class: 'guide__areatext' }, areaText(info.text)),
      list.length > 0 && h('div', { class: 'guide__entries' }, list.map((e) => entryCard(e))),
    );
  });

  function entryCard(e) {
    const visited = ctx.interactions?.isVisited?.(e.id);
    const shown = presentEntry(e, { profile: P });
    const meta = [shown.subtitle, shown.year && !shown.yearDraft ? shown.year : null].filter(Boolean).join(' · ');
    const link = linkFor?.(e.id);
    // (an entry with no words of its own yet stands in its summary / the intro: not twice here)
    const words = [
      shown.body.filter((p) => !shown.bodyFallback && p.text !== e.summary).map((p) => h('p', { class: p.draft ? 'is-draft' : null }, p.text)),
      shown.facts.length > 0 && h('dl', { class: 'guide__facts' }, shown.facts.flatMap(([k, v, draft]) => [h('dt', { class: draft ? 'is-draft' : null }, k), h('dd', { class: draft ? 'is-draft' : null }, v)])),
    ].flat().filter(Boolean);
    const tags = e.tags?.length ? h('ul', { class: 'journal__tags' }, e.tags.map((t) => h('li', { class: 'paper-tag' }, t))) : null;
    const extras = [
      e.kind === 'contact' && contact.cloneNode(true),
      e.links?.length && h('div', { class: 'journal__links' }, e.links.map((l) => h('a', { class: 'stamp-btn', href: l.href, target: '_blank', rel: 'noopener' }, h('span', { html: icon('link') }), l.label))),
    ].filter(Boolean);
    // only real words are folded away: tags and buttons alone show inline
    const more = words.length ? [...words, tags, ...extras].filter(Boolean) : [];
    const inline = words.length ? [] : [tags, ...extras].filter(Boolean);
    const thumb = h('div', { class: 'guide__thumb', html: e.images?.length ? '' : sketchFor(e) }, e.images?.length ? h('img', { src: e.images[0].src, alt: e.images[0].alt ?? '', loading: 'lazy' }) : null);
    if (!e.images?.length && polaroids?.available(e.id)) livePhoto(thumb, e);
    return h(
      'article',
      { class: `guide__entry${e.featured ? ' is-featured' : ''}`, 'aria-labelledby': `guide-e-${e.id}` },
      thumb,
      h(
        'div',
        { class: 'guide__entrytext' },
        h('h4', { id: `guide-e-${e.id}` }, e.title, visited && h('span', { class: 'guide__leaf', title: 'In your journal', html: icon('leaf') })),
        meta && h('p', { class: 'guide__meta' }, meta, shown.yearDraft && showDrafts ? h('span', { class: 'guide__draft' }, 'year: draft') : null),
        e.summary && h('p', { class: 'guide__summary' }, e.summary),
        inline,
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

  /** The thumbnail becomes a live polaroid of the piece once its card comes into view. */
  function livePhoto(thumb, e) {
    const url = polaroids.cached(e.id);
    if (url) return setPhoto(thumb, e, url);
    thumb.classList.add('is-waiting');
    waiting.set(thumb, e);
    if (!io && 'IntersectionObserver' in window) {
      io = new IntersectionObserver(
        (items) => {
          for (const it of items) {
            if (!it.isIntersecting) continue;
            const el = it.target;
            const entry = waiting.get(el);
            io.unobserve(el);
            waiting.delete(el);
            if (entry) polaroids.request(entry.id).then((u) => u && setPhoto(el, entry, u));
          }
        },
        { rootMargin: '120px 0px' },
      );
    }
    io?.observe(thumb);
  }
  function setPhoto(thumb, e, url) {
    thumb.classList.remove('is-waiting');
    thumb.classList.add('is-photo');
    thumb.replaceChildren(h('img', { src: url, alt: '', width: 630, height: 420, decoding: 'async' }));
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
