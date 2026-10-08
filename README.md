# Shadow City

See a familiar city from the sun's point of view. Shadow City shows OpenStreetMap buildings and trees in 3D and casts their real shadows for any time and date, so you can find the benches, terraces, beaches and viewpoints that are in the sun.

## How to run

Requires Node.js 20.19 or newer (or 22.12+) and an internet connection.

```sh
npm install
npm run dev
```

Then open http://localhost:5173.

To build and preview the production version:

```sh
npm run build
npm run preview
```

The preview runs at http://localhost:4173. The built site in `dist/` must be served over HTTP; opening `dist/index.html` directly from disk does not work.

## Usage

- Central Helsinki loads on start. Search for a place in the top bar, or pan and zoom: buildings and places load automatically when the map stops moving (at zoom level 14 or closer).
- Drag the time slider, pick a date, or press Now. The play button runs a time-lapse through the day and night, and the calendar button plays the whole year at the selected time of day. Midsummer, Equinox and Midwinter jump to those dates.
- Places in direct sun are highlighted. The sunny spots list shows the nearest ones and can be filtered by type, for example terraces.
- Click a place to see when it gets sun during the day, along with its opening hours, contact details and Wikipedia summary when available.
- From the sun moves the camera to the sun's position, so everything you see is lit. Into the sun faces the other way, so everything you see is in shade.
- Find me sun uses your location to find the nearest place in the sun.
- Share copies a link to the current view, time and selected place.
- Keyboard: Space plays or pauses, the left and right arrow keys move the time by 5 minutes, N jumps to now, and 1, 2 and 3 switch the camera view.

## How it works

- Frontend only: Vite, React, TypeScript, Chakra UI and MapLibre GL JS.
- Data: buildings, trees and places come from OpenStreetMap through the Overpass API. Search uses Nominatim and place summaries come from Wikipedia. The basemap is OpenFreeMap Positron.
- Sun: SunCalc gives the sun's position for any date and time.
- Shadows: a building's shadow is the area its footprint covers when moved away from the sun by its height divided by the tangent of the sun's altitude.
- Sun or shade: a place is in shade if a line from it toward the sun passes through a building or tree that is taller than the line at that point.
- Building heights come from OpenStreetMap when mapped. Otherwise the height is estimated from the footprint area, up to 9.6 m. Terrain is not modelled.

Map data © OpenStreetMap contributors (ODbL). Basemap © OpenFreeMap and OpenMapTiles.

---

# Softamestari 2026 — esikarsinta on käynnissä

## Suomeksi

Esikarsinta on käynnissä! Aikaa palautukseen on torstaina 8.10.2026 klo 20.00 asti Suomen aikaa (Europe/Helsinki).

<!-- TEHTAVA -->
### Tehtävä

Rakenna OpenStreetMapia hyödyntävä interaktiivinen verkkosovellus teemalla Löytöretki. Miten autat käyttäjää löytämään jotain uutta tai näkemään tutun ympäristön uudesta näkökulmasta?

Toteutus, data ja tyyli ovat täysin vapaita. Sovelluksen tulee toimia pelkästään selaimessa ilman taustajärjestelmää. Liitä mukaan ohjeet sovelluksen käynnistämiseen.

Arvostelukriteerit:

- Idea ja omaperäisyys: Onko toteutus kekseliäs, yllättävä tai hauska? Erotuuko se massasta?
- Käyttökokemus ja ”vau”-efekti: Onko sovellusta innostava ja helppo käyttää? Onko ulkoasu viimeistelty?
- Tekninen toimivuus: Toimiiko sovellus luotettavasti, sulavasti ja ilman bugeja?
<!-- /TEHTAVA -->

### Miten palautat työn

Zippaa projektikansio ja lataa se lomakkeella. Yhden zip-tiedoston enimmäiskoko on 50 Mt (jätäthän `node_modules`-kansion pois paketista).

Zipin mukana pitää olla README, joka kertoo miten työ suoritetaan.

Lomake kysyy samat tiedot kuin ilmoittautumislomake softamestari.fi-sivustolla sekä zip-tiedoston.

- Valitse sarja: Junnusarja (Finaalipäivänä alle 22-vuotiaat koodilupaukset) tai Yleinen sarja (Avoin kaikille)
- Nimi
- Sähköpostiosoite
- Hyväksyn kilpailun säännöt ja tietosuojaselosteen

Palautusosoite:

https://softamestari.curious.fi/esikarsinta/palautus

Voit palauttaa työn vain kerran – onnistunutta palautusta ei voi enää muuttaa tai korvata uudella. Jos siirto katkeaa ennen kuin zip on tallessa, sen voi lähettää uudelleen. Jos siirto on jo alkanut ennen klo 20.00, se hyväksytään. Klo 20.00 jälkeen alkanutta latausta ei oteta vastaan.

Työ on pelkkä frontend-palvelu: ei omaa palvelinta, tietokantaa tai backendiä. Valmiit kirjastot ja frameworkit ovat sallittuja.

Jos tulee ongelmia, ota yhteyttä WhatsAppilla tai tekstiviestillä numeroon 050 374 9132 (Pasi Kovanen).

## In English

The qualifier is running. You have until 20:00 Finnish time (Europe/Helsinki) on Thursday 8 October 2026.

<!-- TASK -->
### Assignment

Build an interactive web application that uses OpenStreetMap, on the theme Voyage of discovery (Löytöretki). How do you help the user find something new, or see a familiar place from a new point of view?

The implementation, the data, and the style are entirely up to you. The application must run in the browser alone, with no backend. Include instructions for how to start the application.

Judging criteria:

- Idea and originality: Is the work inventive, surprising, or fun? Does it stand out?
- Experience and the "wow": Is the application a pleasure and easy to use? Does it look finished?
- Technical reliability: Does the application work reliably, smoothly, and without bugs?
<!-- /TASK -->

### How to submit

Zip the project folder and upload it with the form. One zip may be at most 50 MB (please exclude `node_modules` from the package).

The zip must include a README that explains how to run the work.

The form asks for the same details as the registration form on softamestari.fi, plus the zip file.

- Category: Junior category (Under 22 on the day of the final) or Open category (Open to everyone)
- Name
- Email address
- I accept the contest rules and the privacy notice

Upload address:

https://softamestari.curious.fi/esikarsinta/palautus

You can submit your work only once – a successful submission cannot be replaced or updated. If the transfer breaks before the zip is stored, you may send it again. An upload that has already started before 20:00 is accepted. An upload started after 20:00 is not accepted.

The work is a frontend-only service: no server, database, or backend of your own. Existing libraries and frameworks are allowed.

If you run into problems, contact Pasi Kovanen by WhatsApp or text message at 050 374 9132.
