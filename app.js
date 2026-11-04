/* Muziekontdekker — ontdek genres buiten je bubbel, beoordeel met één tik. */
(() => {
  "use strict";

  const API = "https://api.spotify.com/v1";
  const SCOPES = [
    "user-top-read", "user-read-recently-played",
    "playlist-modify-private", "playlist-modify-public",
    "user-modify-playback-state", "user-read-playback-state",
  ].join(" ");
  const REDIRECT = location.origin + location.pathname.replace(/index\.html$/, "");
  const PACK_SIZE = 5;
  const PLAYLIST_NAME = "Ontdekkingen (Muziekontdekker)";
  const LEVELS = ["Instap", "Kern", "Diep"];
  const G = Object.fromEntries(window.GENRES.map((g) => [g.id, g]));

  const $app = document.getElementById("app");
  const $nav = document.getElementById("nav");

  // ---------- opslag ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };
  const freshState = () => ({ known: [], profileDone: false, genres: {}, rated: {}, knownArtists: [], topArtists: [], playlistId: null, playlistUrl: null, packs: 0, pack: null });
  let S = Object.assign(freshState(), store.get("mo_state", {}));
  const save = () => store.set("mo_state", S);
  const gs = (id) => (S.genres[id] ||= { score: 0, level: 0, likes: 0, dislikes: 0, seen: 0, lvLikes: 0, boost: 0, parked: false, used: [] });

  const clientId = () => store.get("mo_client", "");

  // ---------- hulpjes ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function toast(msg, ms = 2400) {
    const t = document.getElementById("toast");
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), ms);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast("Gekopieerd"); }
    catch { prompt("Kopieer deze tekst:", text); }
  }

  // ---------- Spotify-login (PKCE) ----------
  const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  async function login() {
    const id = clientId();
    if (!id) { toast("Vul eerst je Client ID in"); return; }
    const arr = crypto.getRandomValues(new Uint8Array(48));
    const verifier = b64url(arr);
    const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    store.set("mo_verifier", verifier);
    const p = new URLSearchParams({ response_type: "code", client_id: id, scope: SCOPES, code_challenge_method: "S256", code_challenge: challenge, redirect_uri: REDIRECT });
    location.href = "https://accounts.spotify.com/authorize?" + p;
  }
  async function tokenRequest(params) {
    const r = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId(), ...params }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error_description || j.error || "Inloggen mislukt");
    const old = store.get("mo_token", {});
    store.set("mo_token", { access: j.access_token, refresh: j.refresh_token || old.refresh, exp: Date.now() + (j.expires_in - 60) * 1000 });
  }
  async function handleCallback() {
    const q = new URLSearchParams(location.search);
    if (!q.has("code") && !q.has("error")) return;
    history.replaceState(null, "", REDIRECT);
    if (q.get("error")) { toast("Inloggen geannuleerd"); return; }
    await tokenRequest({ grant_type: "authorization_code", code: q.get("code"), redirect_uri: REDIRECT, code_verifier: store.get("mo_verifier", "") });
    store.del("mo_verifier");
  }
  const loggedIn = () => !!store.get("mo_token", {}).refresh;
  async function token() {
    const t = store.get("mo_token", {});
    if (t.access && Date.now() < t.exp) return t.access;
    if (!t.refresh) throw new Error("Niet ingelogd");
    await tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh });
    return store.get("mo_token", {}).access;
  }
  async function api(path, opts = {}, retry = true) {
    const r = await fetch(API + path, {
      ...opts,
      headers: { Authorization: "Bearer " + (await token()), "Content-Type": "application/json", ...(opts.headers || {}) },
    });
    if (r.status === 401 && retry) { const t = store.get("mo_token", {}); t.exp = 0; store.set("mo_token", t); return api(path, opts, false); }
    if (r.status === 429 && retry) { await sleep((+r.headers.get("Retry-After") || 2) * 1000); return api(path, opts, false); }
    if (r.status === 204) return null;
    const j = await r.json().catch(() => null);
    if (!r.ok) { const e = new Error(j?.error?.message || "Spotify-fout " + r.status); e.status = r.status; e.reason = j?.error?.reason; throw e; }
    return j;
  }

  // ---------- profiel ----------
  function matchGenre(spotifyGenre) {
    const s = spotifyGenre.toLowerCase();
    const hits = [];
    for (const g of window.GENRES) {
      if (g.kw.some((k) => (k.startsWith("=") ? s === k.slice(1) : s.includes(k)))) hits.push(g.id);
    }
    return hits;
  }
  async function buildProfile() {
    const calls = await Promise.allSettled([
      api("/me/top/artists?limit=50&time_range=medium_term"),
      api("/me/top/artists?limit=50&time_range=short_term"),
      api("/me/top/artists?limit=50&time_range=long_term"),
      api("/me/player/recently-played?limit=50"),
    ]);
    const artists = new Map();
    calls.slice(0, 3).forEach((c) => c.status === "fulfilled" && (c.value?.items || []).forEach((a) => artists.set(a.id, a)));
    const recent = calls[3].status === "fulfilled" ? (calls[3].value?.items || []) : [];
    const names = new Set([...artists.values()].map((a) => a.name));
    recent.forEach((it) => (it.track?.artists || []).forEach((a) => names.add(a.name)));

    const weight = {};
    for (const a of artists.values()) for (const sg of a.genres || []) for (const id of matchGenre(sg)) weight[id] = (weight[id] || 0) + 1;
    // Als Spotify geen genres meer meestuurt: herken je artiesten in onze eigen lijsten.
    const normNames = new Set([...names].map(norm));
    for (const g of window.GENRES) g.lv.flat().forEach((n) => { if (normNames.has(norm(n))) weight[g.id] = (weight[g.id] || 0) + 2; });

    const known = Object.entries(weight).filter(([, w]) => w >= 2).sort((a, b) => b[1] - a[1]).map(([id]) => id);
    S.known = known.length ? known : ["edm", "pop"];
    S.knownArtists = [...normNames];
    S.topArtists = [...artists.values()].slice(0, 12).map((a) => a.name);
    save();
  }

  // ---------- recommender ----------
  function centroid() {
    const pts = S.known.map((id) => G[id]?.pos).filter(Boolean);
    if (!pts.length) return [0.2, 0.65];
    return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  }
  function distance(g) {
    const c = centroid();
    const knownFams = new Set(S.known.map((id) => G[id]?.fam));
    return Math.hypot(g.pos[0] - c[0], g.pos[1] - c[1]) + (knownFams.has(g.fam) ? 0 : 0.25);
  }
  const candidates = () => window.GENRES.filter((g) => !S.known.includes(g.id) && !gs(g.id).parked);
  const untested = () => candidates().filter((g) => gs(g.id).seen === 0);
  const likedGenres = () => candidates().filter((g) => gs(g.id).likes > 0).sort((a, b) => (gs(b.id).score + gs(b.id).boost * 2) - (gs(a.id).score + gs(a.id).boost * 2));
  const retryGenres = () => candidates().filter((g) => { const s = gs(g.id); return s.likes === 0 && s.dislikes === 1; });

  function pickFar(pool, n, exclude) {
    // gewogen naar afstand, en zo min mogelijk dezelfde muziekfamilie
    const out = [];
    const fams = new Set();
    let rest = pool.filter((g) => !exclude.has(g.id));
    while (out.length < n && rest.length) {
      const pref = rest.filter((g) => !fams.has(g.fam));
      const from = pref.length ? pref : rest;
      const w = from.map((g) => Math.pow(distance(g), 2) + 0.02);
      let x = Math.random() * w.reduce((a, b) => a + b, 0);
      let i = 0; while (x > w[i] && i < w.length - 1) { x -= w[i]; i++; }
      const g = from[i];
      out.push(g); fams.add(g.fam); exclude.add(g.id);
      rest = rest.filter((r) => r.id !== g.id);
    }
    return out;
  }

  function planPack() {
    const used = new Set();
    const slots = [];
    const liked = likedGenres();
    if (S.packs < 2 || !liked.length) {
      pickFar(untested(), PACK_SIZE, used).forEach((g) => slots.push({ g, kind: "nieuw" }));
    } else {
      const boosted = liked.find((g) => gs(g.id).boost > 0);
      if (boosted) { slots.push({ g: boosted, kind: "dieper" }, { g: boosted, kind: "dieper" }); used.add(boosted.id); gs(boosted.id).boost = 0; }
      for (const g of liked) { if (slots.length >= 2) break; if (!used.has(g.id)) { slots.push({ g, kind: "dieper" }); used.add(g.id); } }
      const r = shuffle(retryGenres()).find((g) => !used.has(g.id));
      if (r) { slots.push({ g: r, kind: "kans" }); used.add(r.id); }
      pickFar(untested(), PACK_SIZE - slots.length, used).forEach((g) => slots.push({ g, kind: "nieuw" }));
    }
    // Aanvullen als alles al geprobeerd is
    const fill = shuffle(candidates());
    while (slots.length < PACK_SIZE && fill.length) slots.push({ g: fill.pop(), kind: "dieper" });
    return shuffle(slots);
  }

  async function findTrack(slot) {
    const s = gs(slot.g.id);
    const level = slot.kind === "nieuw" || slot.kind === "kans" ? 0 : s.level;
    const order = [level, ...[0, 1, 2].filter((l) => l !== level)];
    for (const lv of order) {
      const names = shuffle(slot.g.lv[lv]).filter((n) => !S.knownArtists.includes(norm(n)));
      const fresh = names.filter((n) => !s.used.includes(n));
      for (const name of [...fresh, ...names.filter((n) => s.used.includes(n))]) {
        let res;
        try { res = await api("/search?type=track&limit=10&q=" + encodeURIComponent(`artist:"${name.replace(/"/g, "")}"`)); }
        catch (e) { if (e.status === 401 || e.status === 403) throw e; continue; }
        const items = (res?.tracks?.items || []).filter((t) => t && !S.rated[t.id] && !S.pack?.items?.some((p) => p.id === t.id));
        const target = norm(name);
        const match = items.filter((t) => t.artists.some((a) => norm(a.name) === target));
        const pool = (match.length ? match : []).slice(0, 6);
        if (!pool.length) continue;
        const t = pool[Math.floor(Math.random() * pool.length)];
        s.used = [...new Set([...s.used, name])];
        return {
          id: t.id, uri: t.uri, name: t.name, artists: t.artists.map((a) => a.name).join(", "),
          image: t.album?.images?.[0]?.url || "", url: t.external_urls?.spotify || `https://open.spotify.com/track/${t.id}`,
          gid: slot.g.id, level: lv, kind: slot.kind, seed: name,
        };
      }
    }
    return null;
  }

  async function newPack() {
    renderLoading("Je volgende ontdekpakket wordt samengesteld…");
    const slots = planPack();
    const items = [];
    S.pack = { items, idx: 0 };
    for (const slot of slots) {
      const t = await findTrack(slot);
      if (t) items.push(t);
    }
    if (!items.length) throw new Error("Geen nummers gevonden. Controleer je verbinding of log opnieuw in.");
    S.packs += 1; save();
  }

  function reason(t) {
    const g = G[t.gid];
    if (t.kind === "kans") return `Tweede kans voor ${g.name}, met een ander nummer. ${g.info}`;
    if (t.level === 0) return `Instapnummer in ${g.name}. ${g.info}`;
    if (t.level === 1) return `Je vond ${g.name} goed, dus nu een klassieker uit de kern van het genre.`;
    return `Diep in ${g.name}, omdat je meer wilde.`;
  }

  // ---------- beoordelen ----------
  async function rate(r) {
    const p = S.pack; const t = p?.items[p.idx]; if (!t) return;
    const s = gs(t.gid);
    s.seen++;
    if (r === "nee") {
      s.dislikes++; s.score -= 1;
      if (s.likes === 0 && s.dislikes >= 2) { s.parked = true; toast(`${G[t.gid].name} geparkeerd`); }
    } else {
      s.likes++; s.score += r === "meer" ? 2 : 1; s.lvLikes++;
      if (r === "meer" || (s.lvLikes >= 2 && s.level < 2)) {
        if (s.level < 2) { s.level++; s.lvLikes = 0; }
        if (r === "meer") s.boost = 1;
      }
    }
    S.rated[t.id] = { r, g: t.gid, lv: t.level, name: t.name, artist: t.artists, uri: t.uri, url: t.url, at: Date.now() };
    p.idx++; save();
    if (r !== "nee") addToPlaylist(t.uri).catch((e) => toast("Playlist bijwerken lukte niet: " + e.message, 4000));
    render();
  }
  async function ensurePlaylist() {
    if (S.playlistId) return S.playlistId;
    const pl = await api("/me/playlists", { method: "POST", body: JSON.stringify({ name: PLAYLIST_NAME, public: false, description: "Nummers die je goedkeurde in Muziekontdekker." }) });
    S.playlistId = pl.id; S.playlistUrl = pl.external_urls?.spotify; save();
    return pl.id;
  }
  async function addToPlaylist(uri) {
    const id = await ensurePlaylist();
    try { await api(`/playlists/${id}/items`, { method: "POST", body: JSON.stringify({ uris: [uri] }) }); }
    catch (e) {
      if (e.status === 404) { S.playlistId = null; save(); const id2 = await ensurePlaylist(); await api(`/playlists/${id2}/items`, { method: "POST", body: JSON.stringify({ uris: [uri] }) }); }
      else throw e;
    }
  }
  async function playInApp(t) {
    try { await api("/me/player/play", { method: "PUT", body: JSON.stringify({ uris: [t.uri] }) }); toast("Speelt af in Spotify"); }
    catch { location.href = t.url; }
  }

  // ---------- schermen ----------
  let view = "discover";
  function setNav(on) {
    $nav.hidden = !on;
    $nav.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.go === view));
  }
  function renderLoading(msg) { $app.innerHTML = `<div class="loader"><div class="spin"></div>${esc(msg)}</div>`; }
  function renderError(e) {
    $app.innerHTML = `<h1>Er ging iets mis</h1><div class="card"><p>${esc(e.message || e)}</p>
      <button class="primary wide" id="retry">Opnieuw proberen</button></div>
      <p class="muted small">Blijft dit gebeuren? Ga naar Instellingen en log opnieuw in.</p>`;
    document.getElementById("retry").onclick = () => start();
  }

  function renderSetup() {
    setNav(false);
    $app.innerHTML = `
      <h1>Muziekontdekker</h1>
      <p class="muted">Ontdek muziek buiten je bubbel. Eenmalig instellen, daarna alleen tikken.</p>
      <div class="card">
        <h2 style="margin-top:0">1. Spotify-app aanmaken</h2>
        <ol class="steps">
          <li>Open <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener">developer.spotify.com/dashboard</a> en log in.</li>
          <li>Kies <b>Create app</b>. Naam: bijvoorbeeld <i>Muziekontdekker</i> (het woord "Spotify" mag er niet in).</li>
          <li>Plak bij <b>Redirect URIs</b> dit adres en klik op Add:</li>
        </ol>
        <div class="copyrow"><code>${esc(REDIRECT)}</code><button id="cp">Kopieer</button></div>
        <ol class="steps" start="4">
          <li>Vink <b>Web API</b> aan, accepteer de voorwaarden en sla op.</li>
          <li>Ga naar <b>User Management</b> en voeg je eigen Spotify-e-mailadres toe.</li>
          <li>Kopieer de <b>Client ID</b> van de app (niet het Client Secret).</li>
        </ol>
      </div>
      <div class="card">
        <h2 style="margin-top:0">2. Client ID invullen</h2>
        <input type="text" id="cid" placeholder="Bijv. 3f9a2c…" value="${esc(clientId())}" autocomplete="off" autocapitalize="off" spellcheck="false">
        <button class="primary wide" id="go" style="margin-top:10px">Inloggen met Spotify</button>
      </div>
      ${installHint()}`;
    document.getElementById("cp").onclick = () => copy(REDIRECT);
    document.getElementById("go").onclick = () => {
      const v = document.getElementById("cid").value.trim();
      if (!/^[a-f0-9]{32}$/i.test(v)) { toast("Een Client ID bestaat uit 32 letters en cijfers"); return; }
      store.set("mo_client", v); login();
    };
  }
  function installHint() {
    const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    if (standalone) return "";
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    return `<p class="muted small">Tip: ${ios ? "tik in Safari op de deelknop en kies <b>Zet op beginscherm</b>" : "kies in het browsermenu <b>App installeren</b> of <b>Toevoegen aan startscherm</b>"} om dit als app te gebruiken.</p>`;
  }

  function renderProfile() {
    setNav(false);
    const sel = new Set(S.known);
    const fams = {};
    window.GENRES.forEach((g) => (fams[g.fam] ||= []).push(g));
    $app.innerHTML = `
      <h1>Wat luister je al?</h1>
      <p class="muted">Op basis van je luistergeschiedenis heb ik deze genres aangevinkt. Die sla ik over. Klopt het niet? Tik om aan of uit te zetten.</p>
      ${S.topArtists.length ? `<p class="small muted">Je top-artiesten: ${esc(S.topArtists.slice(0, 8).join(", "))}</p>` : ""}
      <div class="card"><div class="chips">
        ${window.GENRES.map((g) => `<button class="chip ${sel.has(g.id) ? "on" : ""}" data-id="${g.id}">${esc(g.name)}</button>`).join("")}
      </div></div>
      <button class="primary wide" id="startbtn">Start met ontdekken</button>`;
    $app.querySelectorAll(".chip").forEach((b) => b.onclick = () => {
      sel.has(b.dataset.id) ? sel.delete(b.dataset.id) : sel.add(b.dataset.id);
      b.classList.toggle("on");
    });
    document.getElementById("startbtn").onclick = async () => {
      if (!sel.size) { toast("Kies minstens één genre dat je al kent"); return; }
      S.known = [...sel]; S.profileDone = true; S.pack = null; save();
      view = "discover"; render();
    };
  }

  function renderDiscover() {
    setNav(true);
    const p = S.pack;
    if (!p || !p.items.length) { newPack().then(render).catch(renderError); return; }
    if (p.idx >= p.items.length) return renderPackDone();
    const t = p.items[p.idx];
    const g = G[t.gid];
    $app.innerHTML = `
      <div class="top">
        <span class="muted small">Pakket ${S.packs} · ${p.idx + 1} van ${p.items.length}</span>
        <span class="progress">${p.items.map((_, i) => `<i class="${i < p.idx ? "done" : ""}"></i>`).join("")}</span>
      </div>
      <div class="card track" id="trk">
        <div class="stamp yes">GOED</div><div class="stamp no">NEE</div><div class="stamp more">MEER</div>
        <div class="row" style="justify-content:space-between;margin-bottom:10px">
          <span class="pill">${esc(g.name)}</span><span class="pill lv${t.level}">${LEVELS[t.level]}</span>
        </div>
        ${t.image ? `<img class="cover" src="${esc(t.image)}" alt="" draggable="false">` : ""}
        <h3>${esc(t.name)}</h3>
        <p class="artist">${esc(t.artists)}</p>
        <iframe src="https://open.spotify.com/embed/track/${esc(t.id)}?utm_source=generator&theme=0" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy" title="Speler"></iframe>
        <p class="why">${esc(reason(t))}</p>
        <div class="subactions">
          <button id="play">▶ Speel in Spotify-app</button>
        </div>
      </div>
      <div class="actions">
        <button class="no" data-r="nee">✕ Niks voor mij</button>
        <button class="yes" data-r="ja">♥ Vind ik goed</button>
        <button class="more morebtn" data-r="meer">↑ Meer hiervan, dieper</button>
      </div>
      <p class="muted small" style="text-align:center">Of veeg: links = nee, rechts = goed, omhoog = meer</p>`;
    $app.querySelectorAll("[data-r]").forEach((b) => b.onclick = () => animateOut(b.dataset.r));
    document.getElementById("play").onclick = () => playInApp(t);
    enableSwipe(document.getElementById("trk"));
  }
  function animateOut(r) {
    const el = document.getElementById("trk");
    if (el) {
      el.style.transform = r === "nee" ? "translateX(-120%) rotate(-12deg)" : r === "ja" ? "translateX(120%) rotate(12deg)" : "translateY(-120%)";
      el.style.opacity = "0";
    }
    setTimeout(() => rate(r), 180);
  }
  function enableSwipe(el) {
    let x0 = null, y0 = null, dx = 0, dy = 0;
    const stamps = { yes: el.querySelector(".stamp.yes"), no: el.querySelector(".stamp.no"), more: el.querySelector(".stamp.more") };
    el.addEventListener("pointerdown", (e) => { if (e.target.closest("button,iframe,a")) return; x0 = e.clientX; y0 = e.clientY; el.style.transition = "none"; });
    el.addEventListener("pointermove", (e) => {
      if (x0 === null) return;
      dx = e.clientX - x0; dy = e.clientY - y0;
      el.style.transform = `translate(${dx}px, ${Math.min(dy, 0)}px) rotate(${dx / 20}deg)`;
      stamps.yes.style.opacity = Math.max(0, dx / 100);
      stamps.no.style.opacity = Math.max(0, -dx / 100);
      stamps.more.style.opacity = Math.abs(dx) < 60 ? Math.max(0, -dy / 100) : 0;
    });
    const end = () => {
      if (x0 === null) return;
      el.style.transition = "";
      const r = dx > 90 ? "ja" : dx < -90 ? "nee" : dy < -90 && Math.abs(dx) < 60 ? "meer" : null;
      x0 = y0 = null; dx = dy = 0;
      Object.values(stamps).forEach((s) => (s.style.opacity = 0));
      if (r) animateOut(r); else el.style.transform = "";
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }

  function renderPackDone() {
    const items = S.pack.items;
    const res = items.map((t) => ({ t, r: S.rated[t.id]?.r }));
    const liked = res.filter((x) => x.r && x.r !== "nee");
    $app.innerHTML = `
      <h1>Pakket ${S.packs} klaar</h1>
      <p class="muted">${liked.length} van ${items.length} nummers vond je goed${liked.length ? ". Die staan in je playlist." : "."}</p>
      <div class="card"><ul class="genre-list">
        ${res.map(({ t, r }) => `<li><span>${esc(t.name)}<br><span class="muted small">${esc(t.artists)} · ${esc(G[t.gid].name)}</span></span>
          <span>${r === "nee" ? "✕" : r === "meer" ? "↑" : "♥"}</span></li>`).join("")}
      </ul></div>
      <button class="primary wide" id="next">Volgend pakket</button>
      ${S.playlistUrl ? `<a class="btn wide" style="margin-top:8px" href="${esc(S.playlistUrl)}">Open je playlist in Spotify</a>` : ""}`;
    document.getElementById("next").onclick = () => { S.pack = null; save(); render(); };
  }

  function renderMap() {
    setNav(true);
    const cand = window.GENRES.filter((g) => !S.known.includes(g.id));
    const liked = cand.filter((g) => gs(g.id).likes > 0 && !gs(g.id).parked).sort((a, b) => gs(b.id).score - gs(a.id).score);
    const tried = cand.filter((g) => gs(g.id).seen > 0 && gs(g.id).likes === 0 && !gs(g.id).parked);
    const parked = cand.filter((g) => gs(g.id).parked);
    const open = cand.filter((g) => gs(g.id).seen === 0);
    const ratings = Object.values(S.rated);
    const likedTracks = ratings.filter((r) => r.r !== "nee").sort((a, b) => b.at - a.at);
    const line = (g, extra) => `<li><span>${esc(g.name)}<br><span class="muted small">${extra}</span></span></li>`;
    $app.innerHTML = `
      <h1>Mijn muziekkaart</h1>
      <div class="stats">
        <div class="stat"><b>${ratings.length}</b><span>beoordeeld</span></div>
        <div class="stat"><b>${likedTracks.length}</b><span>goedgekeurd</span></div>
        <div class="stat"><b>${liked.length}</b><span>nieuwe genres</span></div>
      </div>
      <h2>Nieuw voor jou en goed bevonden</h2>
      <div class="card">${liked.length ? `<ul class="genre-list">${liked.map((g) => { const s = gs(g.id); const pct = Math.round((s.likes / Math.max(1, s.seen)) * 100);
        return `<li><span>${esc(g.name)}<br><span class="muted small">${LEVELS[s.level]} · ${s.likes}/${s.seen} goed</span></span><span class="bar"><b style="width:${pct}%"></b></span></li>`; }).join("")}</ul>`
        : `<p class="muted">Nog niets. Beoordeel een paar pakketten om je kaart te vullen.</p>`}</div>
      ${tried.length ? `<h2>Nog onzeker</h2><div class="card"><ul class="genre-list">${tried.map((g) => line(g, "Krijgt nog een kans")).join("")}</ul></div>` : ""}
      ${parked.length ? `<h2>Geparkeerd</h2><div class="card"><ul class="genre-list">${parked.map((g) => `<li><span>${esc(g.name)}</span><button class="chip" data-unpark="${g.id}">Terugzetten</button></li>`).join("")}</ul></div>` : ""}
      <h2>Nog te ontdekken</h2>
      <div class="card"><p class="muted small" style="margin:0">${open.map((g) => esc(g.name)).join(" · ") || "Alles geprobeerd!"}</p></div>
      ${likedTracks.length ? `<h2>Laatst goedgekeurd</h2><div class="card"><ul class="genre-list">${likedTracks.slice(0, 25).map((r) =>
        `<li><span>${esc(r.name)}<br><span class="muted small">${esc(r.artist)} · ${esc(G[r.g]?.name || "")}</span></span><a href="${esc(r.url)}">Open</a></li>`).join("")}</ul></div>` : ""}
      ${S.playlistUrl ? `<a class="btn wide" href="${esc(S.playlistUrl)}">Open playlist in Spotify</a>` : ""}
      <button class="wide" id="export" style="margin-top:8px">Kopieer overzicht (om met Claude te bespreken)</button>`;
    $app.querySelectorAll("[data-unpark]").forEach((b) => b.onclick = () => { const s = gs(b.dataset.unpark); s.parked = false; s.dislikes = 0; save(); renderMap(); });
    document.getElementById("export").onclick = () => copy(exportText());
  }
  function exportText() {
    const lines = ["Muziekontdekker-overzicht", "Ken ik al: " + S.known.map((id) => G[id]?.name).join(", "), ""];
    for (const g of window.GENRES) {
      const s = S.genres[g.id]; if (!s || !s.seen) continue;
      lines.push(`${g.name}: ${s.likes} goed / ${s.dislikes} nee, niveau ${LEVELS[s.level]}${s.parked ? " (geparkeerd)" : ""}`);
    }
    lines.push("", "Beoordelingen:");
    Object.values(S.rated).sort((a, b) => a.at - b.at).forEach((r) => lines.push(`${r.r === "nee" ? "✕" : r.r === "meer" ? "↑" : "♥"} ${r.artist} – ${r.name} [${G[r.g]?.name}]`));
    return lines.join("\n");
  }

  function renderSettings() {
    setNav(true);
    $app.innerHTML = `
      <h1>Instellingen</h1>
      <div class="card">
        <h2 style="margin-top:0">Smaakprofiel</h2>
        <p class="muted small">Pas aan welke genres je al kent. Je beoordelingen blijven bewaard.</p>
        <button class="wide" id="prof">Genres die ik al ken aanpassen</button>
        <button class="wide" id="rescan" style="margin-top:8px">Luistergeschiedenis opnieuw inlezen</button>
      </div>
      <div class="card">
        <h2 style="margin-top:0">Spotify</h2>
        <p class="muted small">Redirect URI voor je Spotify-app:</p>
        <div class="copyrow"><code>${esc(REDIRECT)}</code><button id="cp">Kopieer</button></div>
        <p class="muted small">Client ID: ${esc(clientId() || "niet ingesteld")}</p>
        <button class="wide" id="logout">Uitloggen</button>
      </div>
      <div class="card">
        <h2 style="margin-top:0">Opnieuw beginnen</h2>
        <p class="muted small">Wist al je beoordelingen in deze app. Je Spotify-playlist blijft bestaan.</p>
        <button class="wide no" id="reset">Alles wissen</button>
      </div>
      ${installHint()}`;
    document.getElementById("prof").onclick = () => { view = "profile"; render(); };
    document.getElementById("rescan").onclick = async () => { renderLoading("Luistergeschiedenis inlezen…"); try { await buildProfile(); view = "profile"; render(); } catch (e) { renderError(e); } };
    document.getElementById("cp").onclick = () => copy(REDIRECT);
    document.getElementById("logout").onclick = () => { store.del("mo_token"); render(); };
    document.getElementById("reset").onclick = () => {
      if (!confirm("Weet je het zeker? Al je beoordelingen worden gewist.")) return;
      const pl = { playlistId: S.playlistId, playlistUrl: S.playlistUrl };
      S = Object.assign(freshState(), pl); save(); render();
    };
  }

  function render() {
    if (!loggedIn()) return renderSetup();
    if (!S.profileDone || view === "profile") return renderProfile();
    if (view === "map") return renderMap();
    if (view === "settings") return renderSettings();
    return renderDiscover();
  }

  $nav.addEventListener("click", (e) => {
    const b = e.target.closest("[data-go]"); if (!b) return;
    view = b.dataset.go; render(); window.scrollTo(0, 0);
  });

  async function start() {
    try {
      await handleCallback();
      if (loggedIn() && !S.profileDone) { renderLoading("Je luistergeschiedenis wordt ingelezen…"); await buildProfile(); }
      render();
    } catch (e) { renderError(e); }
  }

  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  start();
})();
