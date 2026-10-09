// ─────────────────────────────────────────────────────────────────────────────
// Placeholder copy ("DRAFT — …" in src/content/content.js) until the owner has
// written the real text. A visitor (production build) never sees it: DRAFT
// years, paragraphs and cut-list rows are left out, an entry left without a
// body shows its summary instead, and the example address gets no mail button.
// In development they stay visible with a small "draft" marker, so the owner
// sees what is still to fill in (and a console note lists it once).
//
//   showDrafts                       true in dev (override: ?drafts=show | hide)
//   isDraft(text)                    'DRAFT', 'DRAFT — …'
//   presentEntry(entry) → { year, yearDraft, body: [{ text, draft }], facts: [[k, v, draft]] }
//   mailAddress(profile) → { email, draft } | null
//   reachOut(profile) → { mail, primary, others }   how to get in touch: the mail
//        address when there is one, else the strongest link (LinkedIn, then GitHub,
//        then the first) as the primary "Find me on …" — never a letter without an address
// ─────────────────────────────────────────────────────────────────────────────
const param = (() => {
  try {
    return new URLSearchParams(location.search).get('drafts');
  } catch {
    return null;
  }
})();

export const showDrafts = param === 'show' ? true : param === 'hide' ? false : !!import.meta.env?.DEV;

export const isDraft = (s) => typeof s === 'string' && /^\s*DRAFT\b/.test(s);
/** 'DRAFT — Describe …' → 'Describe …' (the marker says it once, the text need not repeat it). */
const strip = (s) => (isDraft(s) ? s.replace(/^\s*DRAFT\b\s*[—–:-]?\s*/, '') || '…' : s);
const isExampleMail = (e) => typeof e === 'string' && /@example\.(com|org|net)$/i.test(e.trim());

/** What of an entry is shown (drafts filtered out unless showDrafts). */
export function presentEntry(entry) {
  const yearDraft = isDraft(entry.year);
  const year = !entry.year || (yearDraft && !showDrafts) ? null : yearDraft ? 'draft' : String(entry.year);
  let body = (entry.body ?? []).map((text) => ({ text: strip(text), draft: isDraft(text) })).filter((p) => showDrafts || !p.draft);
  // nothing real to say yet: the one-line summary stands in (it is the owner's own text)
  if (!body.length && entry.summary && !isDraft(entry.summary)) body = [{ text: entry.summary, draft: false }];
  const facts = (entry.facts ?? []).map(([k, v]) => [strip(k), strip(v), isDraft(v) || isDraft(k)]).filter((f) => showDrafts || !f[2]);
  return { year, yearDraft, body, facts };
}

/** The mail address to offer (null when there is none or it is the placeholder in production). */
export function mailAddress(profile) {
  const email = profile?.email;
  if (!email) return null;
  const draft = isExampleMail(email);
  if (draft && !showDrafts) return null;
  return { email, draft };
}

const LINK_RANK = { linkedin: 0, github: 1 };
/** How a visitor reaches the owner: mail first; without one, the strongest link leads. */
export function reachOut(profile) {
  const mail = mailAddress(profile);
  const links = [...(profile?.links ?? [])].filter((l) => l?.href);
  if (mail) return { mail, primary: null, others: links };
  const ranked = links.map((l, i) => [LINK_RANK[l.icon] ?? 9, i, l]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const primary = ranked[0]?.[2] ?? null;
  return { mail: null, primary, others: links.filter((l) => l !== primary) };
}

let reported = false;
/** Dev only (not in screenshot mode): list the placeholder fields still waiting for real text. */
export function reportDrafts(content) {
  if (reported || !import.meta.env?.DEV) return;
  reported = true;
  try {
    if (new URLSearchParams(location.search).has('shots')) return;
  } catch {
    /* ignore */
  }
  const todo = [];
  if (isExampleMail(content.profile?.email)) todo.push('profile.email (example address)');
  for (const [id, e] of Object.entries(content.entries ?? {})) {
    const f = [];
    if (isDraft(e.year)) f.push('year');
    if (isDraft(e.summary)) f.push('summary');
    const nb = (e.body ?? []).filter(isDraft).length;
    if (nb) f.push(`${nb} paragraph${nb > 1 ? 's' : ''}`);
    const nf = (e.facts ?? []).filter(([k, v]) => isDraft(k) || isDraft(v)).length;
    if (nf) f.push(`${nf} fact${nf > 1 ? 's' : ''}`);
    if (f.length) todo.push(`${id}: ${f.join(', ')}`);
  }
  if (todo.length) console.warn(`[content] ${todo.length} entries still have DRAFT placeholder text (hidden in production builds) — src/content/content.js:\n  ${todo.join('\n  ')}`);
}
