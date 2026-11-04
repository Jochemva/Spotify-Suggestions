# Muziekontdekker

Een kleine web-app (installeerbaar op je telefoon) die je helpt muziek buiten je bubbel te ontdekken.

- Leest je top-artiesten en recent beluisterde nummers via de Spotify Web API en maakt daar een smaakprofiel van.
- Geeft je pakketjes van 5 nummers uit genres die ver van je huidige smaak af liggen, steeds beginnend bij een toegankelijk instapnummer.
- Beoordelen met één tik of veeg: **nee**, **goed**, of **meer hiervan, dieper**.
- Goede genres gaan een niveau dieper (Instap → Kern → Diep). Afgekeurde genres krijgen één tweede kans en worden daarna geparkeerd.
- Goedgekeurde nummers komen automatisch in de playlist *Ontdekkingen (Muziekontdekker)* in je Spotify.

## Instellen
1. Maak een app aan op <https://developer.spotify.com/dashboard> (Web API) met als Redirect URI het adres van deze site, bijvoorbeeld `https://jochemva.github.io/spotify-suggestions/`.
2. Voeg je eigen Spotify-e-mailadres toe onder **User Management**.
3. Open de site, plak de Client ID en log in.
4. Zet de site op je beginscherm om hem als app te gebruiken.

Alles draait in je browser: er is geen server, en je gegevens blijven op je eigen toestel (localStorage).

## Bestanden
- `genres.js`: de genre-kennisbank (positie op de kaart, trefwoorden, artiesten per niveau). Pas deze aan om genres toe te voegen.
- `app.js`: login (PKCE), profiel, aanbevelingslogica en schermen.
- `sw.js` + `manifest.webmanifest`: zorgen dat de site als app te installeren is.
