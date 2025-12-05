# Samohostowalny klon Agar.io

Pełny, samodzielny serwer + klient Agar.io gotowy do uruchomienia w Twojej infrastrukturze. Projekt zawiera
symulację serwera w Node.js (podziały, wyrzut masy, wirusy, masa resztkowa, łączenie komórek, leaderboard) oraz
lekki klient HTML5/canvas z minimapą, trybem widza i responsywnym interfejsem.

## Funkcje gry
- Replika mechaniki Agar.io: jedzenie kulek, pożeranie mniejszych graczy, podziały (Space), wyrzut masy (W), wirusy,
  fragmentacja przy dużej masie oraz powrót do gry (Enter).
- Masa gracza ulega stopniowemu rozpadowi jak w oryginale (anti-camping), a komórki łączą się po czasie ochronnym.
- Wirusy można dokarmiać wyrzuconą masą – po przekroczeniu progu wystrzeliwują nowy wirus w losowym kierunku.
- Leaderboard TOP10 w czasie rzeczywistym, najlepszy wynik gracza, tryb widza po śmierci oraz minimapa pozycji.
- Obsługa myszy/klawiatury/ekranu dotykowego, płynna kamera i skalowanie pola gry.

## Wymagania
- Docker oraz docker-compose **lub** środowisko Node.js 18+ (jeśli chcesz uruchomić bez konteneryzacji).
- W zależności od środowiska pakiet `nanoid` jest przypięty do wersji 3.3.7, która działa z CommonJS
  (`require`).

## Uruchomienie (Docker)
```bash
docker-compose up --build -d
```
Serwer będzie dostępny pod adresem `http://localhost:3886` (port hosta mapowany na port 80 kontenera).

## Uruchomienie lokalne (bez Dockera)
```bash
npm install
npm start
```
Aplikacja nasłuchuje na porcie `80` (możesz nadpisać zmienną `PORT`).

## Struktura
- `server/index.js` – serwer Express + WebSocket, pętla gry, kolizje, wirusy, rozpady masy i aktualizacje dla klientów.
- `public/index.html` – klient canvas z HUD, leaderboardem, minimapą i sterowaniem.
- `docker-compose.yml` / `Dockerfile` – gotowe do zbudowania konteneryzowane środowisko (port 3886 na hoście).

## Sterowanie
- **Mysz / dotyk** – kierunek ruchu
- **Spacja** – podział
- **W** – wyrzut masy
- **Enter** – natychmiastowe odrodzenie po śmierci

## Licencja
Projekt w duchu edukacyjnym – samodzielny serwer/klient inspirowany mechaniką Agar.io, do własnego hostingu.
