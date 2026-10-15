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
//   presentEntry(entry, { profile }) → { year, yearDraft, subtitle, body: [{ text, draft }],
//        bodyFallback, facts: [[k, v, draft]] }
//        With a profile: the About page stands in the profile's intro (not its one-line
//        summary) while its own words are drafts, and without a mail address the copy
//        never promises a letter (see withoutMailPromise; an entry's own
//        `noMail: { subtitle, body }` wins when the owner has written one).
//   mailAddress(profile) → { email, draft } | null
//   reachOut(profile) → { mail, primary, others }   how to get in touch: the mail
//        address when there is one, else the strongest link (LinkedIn, then GitHub,
//        then the first) as the primary "Find me on …" — never a letter without an address
//   withoutMailPromise(text) → text   the owner's sentence / clause that promises a
//        letter ("Drop me a line.", "— and the mailbox is always open") left out
//   linkAddress(link) → 'github.com/JonnysCode'   a link's address, as printed on a card
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

// a letter, a mailbox, an e-mail: words that need an address to keep their promise
const MAIL_PROMISE = /\b(mail ?box(es)?|e-?mails?|mail|letters?|drop me a (line|note)|write (to )?me|postbox)\b/i;
/**
 * The owner's words without the part that promises a letter (no address to send
 * one to): a clause after a dash, else the whole sentence, is left out. Nothing
 * left → ''.
 */
export function withoutMailPromise(text) {
  if (typeof text !== 'string' || !MAIL_PROMISE.test(text)) return text;
  const sentences = text.split(/(?<=[.!?…])\s+/);
  const kept = [];
  for (const s of sentences) {
    if (!MAIL_PROMISE.test(s)) {
      kept.push(s);
      continue;
    }
    // "Here is a bit about me — and the mailbox is always open." → "Here is a bit about me."
    const clauses = s.split(/\s+[—–]\s+/);
    const ok = clauses.filter((c) => !MAIL_PROMISE.test(c));
    if (ok.length && ok.length < clauses.length) {
      let t = ok.join(' — ').trim();
      if (!/[.!?…]$/.test(t)) t += /[!?]$/.test(s.trim()) ? s.trim().slice(-1) : '.';
      kept.push(t);
    }
  }
  return kept.join(' ').trim();
}

/** 'https://github.com/JonnysCode' → 'github.com/JonnysCode' (as printed on a calling card). */
export function linkAddress(link) {
  try {
    const u = new URL(link.href);
    if (u.protocol === 'mailto:') return u.pathname;
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}`;
  } catch {
    return link.label ?? '';
  }
}

/** What of an entry is shown (drafts filtered out unless showDrafts). */
export function presentEntry(entry, { profile = null } = {}) {
  const yearDraft = isDraft(entry.year);
  const year = !entry.year || (yearDraft && !showDrafts) ? null : yearDraft ? 'draft' : String(entry.year);
  let subtitle = entry.subtitle && !isDraft(entry.subtitle) ? entry.subtitle : entry.subtitle && showDrafts ? strip(entry.subtitle) : null;
  let body = (entry.body ?? []).map((text) => ({ text: strip(text), draft: isDraft(text) })).filter((p) => showDrafts || !p.draft);
  let bodyFallback = false;
  // no address to write to: the contact copy must not promise a letter
  const noMail = !!profile && (entry.kind === 'contact' || entry.kind === 'about') && !mailAddress(profile);
  if (noMail) {
    const own = entry.noMail;
    if (own?.subtitle !== undefined || own?.body !== undefined) {
      if (own.subtitle !== undefined) subtitle = own.subtitle || null;
      if (own.body !== undefined) body = [].concat(own.body ?? []).filter(Boolean).map((text) => ({ text, draft: false }));
    } else {
      body = body.map((p) => ({ ...p, text: withoutMailPromise(p.text) })).filter((p) => p.text);
      if (subtitle && withoutMailPromise(subtitle) !== subtitle) {
        // ("The mailbox is always open" → the page's own summary, when that promises nothing)
        const sum = entry.summary && !isDraft(entry.summary) ? withoutMailPromise(entry.summary) : '';
        subtitle = sum && sum === entry.summary ? sum : withoutMailPromise(subtitle) || null;
      }
    }
  }
  // nothing real to say yet: the owner's own words stand in — on the About page the
  // profile's introduction (not the one-line teaser), elsewhere the summary
  if (!body.length) {
    const intro = entry.kind === 'about' && profile?.intro && !isDraft(profile.intro) ? profile.intro : null;
    const summary = entry.summary && !isDraft(entry.summary) ? (noMail ? withoutMailPromise(entry.summary) : entry.summary) : null;
    const text = intro ?? (summary && summary !== subtitle ? summary : null);
    if (text) {
      body = [{ text, draft: false }];
      bodyFallback = true;
    }
  }
  const facts = (entry.facts ?? []).map(([k, v]) => [strip(k), strip(v), isDraft(v) || isDraft(k)]).filter((f) => showDrafts || !f[2]);
  return { year, yearDraft, subtitle, body, bodyFallback, facts };
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
