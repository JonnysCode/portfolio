// ─────────────────────────────────────────────────────────────────────────────
// The snail-lift RIDE — "hop on a snail" (the intro card's promise).
//
// Clicking the snail, the bell at its boarding platform on the roots or the
// gate of the lift slot up on the deck rings for a ride: the camera glides
// over to the station while the snail hurries there and turns round
// (elevator.ride()), then rides along beside the basket up the trunk (or down
// it) — past the round window and the stair landing, under the deck as the
// snail rises into its slot — and the regular glide (cameraRig.goTo) then
// cranes up over the rim into the Code Loft as it arrives on the deck (riding
// down: settles into the Schreinerei as it lands on the roots). ~4.6 s of
// ride after an approach of 1.6–3.4 s; a bell as it sets off, a pop on arrival.
//
//   const ride = createLiftRide(ctx, { elevator, deck })
//   ride.start('up' | 'down')    'up': roots → Code Loft, 'down': deck → Schreinerei
//   ride.update(dt)              (loft.js, every frame)
//   ride.active                  true while the camera rides along
//
// The camera is flown through the rig's override (cameraRig.setOverride, as a
// cut-scene): the spot switches right at the start (rig.goTo — the UI names the
// destination, the markers hide while a glide is pending) and the final glide
// starts from wherever the ride left the lens. Going anywhere else meanwhile
// (a spot pill, a page, a key) hands the camera straight back to the rig.
// The ride's vantage — which side of the track, how far round the trunk, how
// far out — is chosen on the first ride by sampling it for solid things in the
// sight line (interactions.firstSolidHit), the camera's obstacles and the
// deck's footprint, so neighbours moving things about never park the lens
// inside a cap or behind a trunk (the preferred one is tried first: ~9 rays).
// prefers-reduced-motion: no ride — the plain cross-fade to the spot.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { OAK } from '../../world/layout.js';
import { getHeight } from '../../world/ground.js';
import { polar } from './kit.js';

const DEST = { up: 'code', down: 'woodworking' };
const DECK_Y = OAK.loft.y;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/** a smooth min (rounded over k) */
const smin = (a, b, k) => (a + b - Math.sqrt((a - b) * (a - b) + k * k)) / 2;
const smooth = (e0, e1, x) => {
  const t = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

export function createLiftRide(ctx, { elevator, deck }) {
  const reduced = !!ctx.engine?.reducedMotion;
  const { a } = elevator.axis;
  const yBottom = elevator.subjectAt(elevator.stations.bottom, new THREE.Vector3()).y;
  // world → deck-local (deck.at maps deck-local → world): for the deck's footprint
  const deckInverse = new THREE.Matrix4();
  {
    const o = deck.at(0, 0), x = deck.at(1, 0).sub(o), z = deck.at(0, 1).sub(o);
    deckInverse.makeBasis(x, new THREE.Vector3(0, 1, 0), z).setPosition(o.x, DECK_Y, o.z).invert();
  }
  let active = null;

  // scratch
  const S = new THREE.Vector3();
  const P = new THREE.Vector3();
  const L = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const dir = new THREE.Vector3();

  /**
   * How high the lens rides: a little above the subject at the roots, nearly
   * level with it further up — and always well under the deck: there it
   * watches the snail rise into the slot (riding up, the glide to the Code
   * Loft takes over as it reaches the planks and craning up over the rim
   * shows it arrive) or come down out of it (riding down). Level with the
   * deck the rim and the railing hid it, and the lens cut through the ivy.
   */
  const UNDER = DECK_Y - 1.15;
  const lensY = (y) => smin(y + 1.1 - 0.8 * smooth(yBottom + 1.0, DECK_Y - 1.6, y), UNDER, 0.5);

  /**
   * Camera position & look point riding beside the basket with the hook at
   * hookY (d: 'up' | 'down', k: 0..1 along the ride — the lens drifts a little
   * round the trunk as it climbs; at a given height it stands at the same
   * place whichever way the snail goes).
   */
  function follow(v, d, hookY, k, outP, outL) {
    elevator.subjectAt(hookY, S);
    const aC = a + v.side * (v.phi + 0.12 * (d === 'up' ? k : 1 - k));
    polar(aC, v.r, lensY(S.y), outP);
    // the subject a little below the middle: room above it on the way up, below on the way down
    outL.copy(S).y += d === 'up' ? 0.3 : -0.25;
    return outP;
  }

  /**
   * The vantage beside the track — which side, how far round the trunk, how
   * far out — is the first of these (in order of preference) with a clear
   * view of the whole ride, else the clearest. One of the nine samples may be
   * hidden: from under the planks the snail arriving on the deck always is.
   * The front side looks the way the Code Loft and Schreinerei cameras do.
   * Chosen once, on the first ride (both ways ride the same line).
   */
  const VANTAGES = [[-1, 0.7, 10.6], [-1, 0.56, 10.6], [-1, 0.42, 9.6], [-1, 0.7, 9.6], [1, 0.56, 10.6], [1, 0.42, 9.6], [1, 0.7, 10.6]];
  let vantage = null;
  function scoreVantage(v) {
    const it = ctx.interactions;
    const obs = ctx.cameraRig?.obstacles;
    let score = 0;
    for (let i = 0; i <= 8; i++) {
      const k = i / 8;
      const hy = THREE.MathUtils.lerp(elevator.stations.bottom, elevator.stations.top, k);
      follow(v, 'up', hy, k, P, L);
      if (P.y < getHeight(P.x, P.z) + 0.7) score -= 2;
      if (obs?.penetration && obs.penetration(P) > 0.05) score -= 3;
      // never inside the deck's footprint near its height
      if (Math.abs(P.y - DECK_Y) < 1.0) {
        const loc = tmp.copy(P).applyMatrix4(deckInverse);
        if (deck.insideOutline(loc.x, loc.z, -0.9)) score -= 3;
      }
      if (it?.firstSolidHit) {
        elevator.subjectAt(hy, S);
        const dist = P.distanceTo(S);
        dir.subVectors(S, P).divideScalar(dist || 1);
        const hit = it.firstSolidHit(P, dir, 0.25, Math.max(0.3, dist - 1.0), elevator.carrier);
        score += hit === Infinity ? 1 : 0.6 * (hit / dist);
      } else score += 1;
    }
    return score;
  }
  function chooseVantage() {
    if (vantage) return vantage;
    let best = null;
    for (const [side, phi, r] of VANTAGES) {
      const v = { side, phi, r };
      v.score = scoreVantage(v);
      if (!best || v.score > best.score + 1e-6) best = v;
      if (v.score >= 7.9) break;
    }
    return (vantage = best);
  }
  function start(d = 'up') {
    const rig = ctx.cameraRig;
    const dest = DEST[d] ?? 'code';
    if (!rig) return;
    if (reduced || !rig.setOverride || !elevator.ride) {
      rig.goTo(dest);
      return;
    }
    if (active || elevator.riding) return;
    const v = chooseVantage();
    const cam = ctx.camera;
    // the approach: from wherever the lens is to the ride's first vantage
    const p0 = cam.position.clone();
    const t0 = rig.target.clone();
    const from = d === 'down' ? elevator.stations.top : elevator.stations.bottom;
    const p3 = follow(v, d, from, 0, new THREE.Vector3(), new THREE.Vector3());
    const t3 = L.clone();
    const hop = p0.distanceTo(p3);
    let p1, p2;
    if (hop > 7 && rig.obstacles?.plan) {
      const plan = rig.obstacles.plan(p0, p3, { lift: Math.min(5, hop * 0.1), t0, t3, fov: cam.fov, aspect: cam.aspect || 16 / 9 });
      p1 = plan.p1;
      p2 = plan.p2;
    } else {
      p1 = p0.clone().lerp(p3, 0.33);
      p2 = p0.clone().lerp(p3, 0.67);
      p1.y += hop * 0.08;
      p2.y += hop * 0.08;
    }
    const approach = THREE.MathUtils.clamp(1.25 + hop * 0.045, 1.6, 3.4);
    const state = elevator.ride(d, { call: approach });
    active = { d, dest, v, state, t: 0, approach, p0, p1, p2, p3, t0, bez: rig.obstacles?.bezier, departed: false, released: false, aborted: false };
    // the place changes now (the UI names it, history, markers wait for the landing);
    // its glide only starts once the ride lets go of the lens. (An open page
    // closes: riding to the place it is at, the UI would keep it open.)
    if (ctx.ui?.isPanelOpen) ctx.ui.closePanel?.();
    rig.goTo(dest);
    place(0);
  }

  function place(dt) {
    const A = active;
    const rig = ctx.cameraRig;
    A.t += dt;
    const st = A.state;
    const live = elevator.hookY;
    if (A.t < A.approach) {
      const k = easeInOut(A.t / A.approach);
      if (A.bez) A.bez(A.p0, A.p1, A.p2, A.p3, k, P);
      else P.lerpVectors(A.p0, A.p3, k);
      // the eye turns towards the snail as it comes (it may still be hurrying to the station)
      follow(A.v, A.d, live, 0, tmp, L);
      L.lerpVectors(A.t0, L, Math.min(1, k * 1.15));
    } else if (st.phase === 'call') {
      // at the station: watch it arrive and turn round
      P.copy(A.p3);
      follow(A.v, A.d, live, 0, tmp, L);
    } else {
      follow(A.v, A.d, live, st.progress, P, L);
    }
    rig.setOverride(P, L, elevator.subjectAt(live, tmp));
  }

  /** Riding up, the camera lets go as the snail reaches the planks; riding down, as it lands. */
  const releaseNow = (A) => (A.d === 'up' ? A.state.phase === 'ride' && elevator.subjectAt(elevator.hookY, tmp).y >= DECK_Y - 1.0 : A.state.phase === 'done' || A.state.progress > 0.985);

  /**
   * The first search builds the sight-line grids of the meshes it crosses (a
   * one-off of a few hundred ms in a software renderer): done while the visitor
   * lingers at the Schreinerei or the Code Loft — in idle time — not on the click.
   */
  let lingered = 0, preparing = false;
  function prepare(dt) {
    const rig = ctx.cameraRig;
    if (preparing || vantage || reduced || !rig) return;
    if (rig.transitioning || (rig.spot !== 'woodworking' && rig.spot !== 'code')) {
      lingered = 0;
      return;
    }
    if ((lingered += dt) < 1.5) return;
    preparing = true;
    const idle = typeof window !== 'undefined' && window.requestIdleCallback;
    if (idle) idle(() => chooseVantage(), { timeout: 4000 });
    else setTimeout(() => chooseVantage(), 0);
  }

  function update(dt) {
    const A = active;
    if (!A) return prepare(dt);
    const rig = ctx.cameraRig;
    // the lift was reset under us (debug setTime / setPhase): let go
    if (elevator.riding !== A.state && !A.state.done) {
      if (!A.released) rig?.clearOverride();
      active = null;
      return;
    }
    // the visitor went somewhere else meanwhile: hand the camera back (the snail finishes its ride)
    if (!A.released && (!rig || rig.spot !== A.dest || rig.focused)) {
      rig?.clearOverride();
      A.released = A.aborted = true;
    }
    if (!A.departed && A.state.phase === 'ride') {
      A.departed = true;
      if (!A.aborted) ctx.audio?.play?.('twinkle'); // the station bell: off we go
    }
    if (!A.released && releaseNow(A)) {
      // the regular glide settles the lens into the spot's composition from here
      rig.clearOverride();
      rig.goTo(A.dest);
      A.released = true;
    }
    if (A.state.done) {
      if (!A.aborted) ctx.audio?.play?.('pop'); // arrived
      active = null;
      return;
    }
    if (!A.released) place(dt);
  }

  return {
    start,
    update,
    /** true while the camera rides along */
    get active() {
      return !!active && !active.released;
    },
    /** debug: the chosen vantage ({ side, phi, r, score }) */
    vantage: () => chooseVantage(),
  };
}
