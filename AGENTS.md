# AGENTS.md: context voor AI-assistenten (Codex, Claude)

## Doel van het project
Jochem wil uit zijn Spotify-bubbel. Zijn aanbevelingen blijven hangen binnen wat hij al luistert (vooral EDM en pop). Deze app helpt hem **actief nieuwe genres te ontdekken** met zo weinig mogelijk moeite:
- Eerst **bewust ver buiten zijn smaak** beginnen (bijvoorbeeld rap, hardcore, jazz, afrobeats), elk genre via een toegankelijk instapnummer.
- Beoordelen met één tik of veeg: **nee / goed / meer hiervan, dieper**.
- De app leert: goede genres gaan dieper (Instap → Kern → Diep), afgekeurde genres krijgen één tweede kans en worden daarna geparkeerd.
- Goedgekeurde nummers komen automatisch in een Spotify-playlist.
- Gebruik: **op zijn telefoon als app** (PWA, "Zet op beginscherm"). Een App Store-versie is niet nodig.
- Taal van de interface: **Nederlands**.

## Huidige opzet
- Statische site, geen build en geen server. Gehost via **GitHub Pages** vanaf `main` / root: `https://jochemva.github.io/Spotify-Suggestions/`
- `index.html`, `style.css`, `app.js` (alle logica), `genres.js` (genre-kennisbank), `sw.js` + `manifest.webmanifest` (PWA), `icons/`.
- Spotify-login via **Authorization Code + PKCE** in de browser (alleen de Client ID, geen secret). De Client ID vult de gebruiker in de app in (localStorage `mo_client`).
- Alle staat staat in localStorage (`mo_state`, `mo_token`).
- Scopes: user-top-read, user-read-recently-played, playlist-modify-private/public, user-modify-playback-state, user-read-playback-state.

## Aanbevelingslogica (app.js)
- **Profiel:** `/me/top/artists` (short/medium/long term) en `/me/player/recently-played`. Spotify-genres en artiestnamen worden gekoppeld aan genres in `genres.js`. Bij een gewicht van 2 of meer telt een genre als "bekend" en wordt het overgeslagen. De gebruiker kan dit aanpassen.
- **Afstand:** elk genre heeft `pos: [akoestisch 0..1, intensiteit 0..1]` en een familie `fam`. De afstand is de afstand tot het gemiddelde van de bekende genres, plus 0.25 als de familie nieuw is.
- **Pakketten van 5:** de eerste 2 pakketten bevatten alleen nieuwe genres, gewogen naar afstand² en zoveel mogelijk uit verschillende families. Daarna: 2 nummers dieper in goedgekeurde genres ("meer" geeft voorrang), 1 tweede-kans-genre, en de rest nieuw.
- **Nummer kiezen:** `/search?type=track&q=artist:"Naam"` (maximaal 10 resultaten). Alleen nummers waarvan de artiestnaam exact overeenkomt, nog niet beoordeeld, en geen artiesten die de gebruiker al luistert.
- **Beoordeling:** "nee" kost 1 punt; bij 2 keer nee en 0 keer goed wordt het genre geparkeerd. "goed" levert 1 punt op, en na 2 keer goed op hetzelfde niveau gaat het genre een niveau omhoog. "meer" levert 2 punten op, gaat direct een niveau omhoog en geeft voorrang in het volgende pakket.
- **Playlist:** `POST /me/playlists`, daarna `POST /playlists/{id}/items`.

## Spotify API-beperkingen (Development Mode, sinds feb. 2026)
- De eigenaar heeft Premium nodig (Jochem heeft Premium). Maximaal 5 gebruikers, die in het dashboard onder User Management moeten staan.
- **Bestaan niet meer:** recommendations, related-artists, audio-features, artist top-tracks, browse/categorieën en batch-GET-endpoints. Ook `preview_url` (geen 30-secondefragmenten meer) en de velden popularity/followers zijn weg.
- Zoeken geeft maximaal 10 resultaten per verzoek, dus gebruik `offset` voor meer.
- Playlist-endpoints gebruiken `/items`, niet `/tracks`.
- De aanbevelingen komen daarom uit onze eigen kennisbank (`genres.js`), niet van Spotify.
- Afspelen: Spotify-embed-iframe (in een mobiele browser vaak alleen fragmenten) en een knop die `PUT /me/player/play` op een actief apparaat probeert, met als terugval het openen van de Spotify-link (de Spotify-app opent dan).
- De Web Playback SDK werkt niet in mobiele browsers.

## Status (4 nov 2026)
- v1 gebouwd en getest in Playwright (iPhone-emulatie, nagebootste API): alle schermen, vegen en het bijwerken van de playlist werken.
- **Nog te doen door Jochem:** GitHub Pages aanzetten, een Spotify-app aanmaken (Redirect URI = het adres dat de app op het startscherm toont, inclusief hoofdletters) en de Client ID invullen.
- **Nog niet getest met de echte Spotify API.** Controleer eerst of `/me/top/artists` nog `genres` teruggeeft. Zo niet, dan valt het profiel terug op het herkennen van artiestnamen.

## Ideeën voor later
- Meer genres en artiesten per niveau in `genres.js`, en per genre een "tweede invalshoek" (andere instapartiesten).
- Wekelijkse ontdekplaylist automatisch vullen.
- De knop "Kopieer overzicht" op Mijn kaart exporteert alle beoordelingen als tekst, zodat een AI-assistent de kennisbank verder kan afstemmen.
- Eventueel een gedeelde staat tussen apparaten (nu alleen localStorage).

## Werkafspraken
- Houd de site statisch en zonder afhankelijkheden, zodat GitHub Pages blijft werken.
- Bij elke wijziging aan bestanden in de app-shell: verhoog `CACHE` in `sw.js` (bijvoorbeeld `ontdekker-v2`), anders blijven telefoons de oude versie tonen.
- Gebruik het woord "Spotify" niet in de app-naam (regel van Spotify).
