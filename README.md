# Guess Who? · Seeds Congress 2026

- **Game:** https://reemabdelazim.github.io/guess-who/
- **Admin:** https://reemabdelazim.github.io/guess-who/admin/

The game has no admin buttons or links. Only `/admin` can change people, photos, positions, questions and settings.

## How to play

Two players (or teams) compete head-to-head, live, from two different laptops. The board has 18 people: prominent Muslim figures, historical and contemporary, plus a few world-famous leaders. Prophets and companions of the Prophet ﷺ are shown as Arabic name cards instead of pictures.

1. One player opens the game and clicks **Start a new game**. They get a 4-letter game code and a link to send to the other player.
2. Each player chooses **Player 1** or **Player 2** and types their name. Each player then has their own link (`?game=CODE&p=1` or `&p=2`). You can change your name at the top of the screen at any time.
3. Each player secretly picks a person and locks them in. Click the **i** on a card to learn about someone.
4. Press **Start clock**. One clock runs for the whole game (5 minutes by default). Only the host can pause it or add time, from the admin page.
5. Take turns asking yes-or-no questions. By default you talk it over and ask out loud, then press **Done** to pass the turn. Typing is optional: a typed question appears on the other laptop with **Yes** / **No** buttons.
6. Click a card to rule that person out. Click it again to bring them back.
7. **Locking in a guess ends the round straight away** for both players. A right guess wins the round; a wrong guess gives it to the other player. Both secret people are revealed.
8. If there's time left, the **next round starts automatically** after a few seconds and you each pick a new secret person. The player who asks first switches every round.
9. When the clock runs out, the game shows the final score and who won. **Rematch** starts a fresh game with the same two players.

Each player's secret person stays on their own laptop until the round ends. If a laptop refreshes or reconnects, the player rejoins the same game automatically.

## Admin

Open `/admin` on any device and enter the admin password. There's nothing to install and no GitHub account needed.

- **Live games:** every game from the last 24 hours, with both players, the round and the clock. Pause, resume, +1 min and −1 min take effect on both players' screens straight away. Before a game's clock starts, you can also change its length or start the clock. Each game also shows the score. Players can't do any of this.
- **People:** name, position (the line under the name), the facts players see when they click **i**, and photo. *Get from Wikipedia* takes a name or a Wikipedia link and pulls that page's main photo. *Upload file* uses your own photo. The *Photo position* slider moves the crop up or down so faces stay in frame.
- **Example questions:** ideas shown to players when it's their turn to ask.
- **Settings:** title, edition label, and the default time limit for new games.
- Click **Save changes**. New games use the changes straight away.

The admin password belongs to one Firebase account, `admin@seeds-guess-who.web.app`, under **Authentication** in the Firebase console for the project `seeds-guess-who`. To change the password, open that user there and reset it. The database rules (`database.rules.json`) only let that account edit content or change a game's timer.

## Files

- `index.html`, `game.js`, `brand.css`, `assets/`: the game and the Seeds Congress branding.
- `admin/`: the admin page.
- `data/data.json`: the starter people, facts and questions. The live copy that admin edits is in the database under `/content`.
- `uploads/`: the starter photos and the Arabic name cards (`namecard-*.svg`). Photos added in admin are stored in the database.
- `firebase-config.js`, `database.rules.json`, `firebase.json`: the live-game connection to the Firebase project `seeds-guess-who` (Realtime Database). Games are stored under `/games/CODE`.

To preview locally, run a static server (the live games still go through Firebase) in this folder (for example `python -m http.server`) and open http://localhost:8000.

Photos come from Wikimedia Commons, and each person's source page is stored in `data.json`. Most of these images are CC-licensed and need credit if you republish them outside the game.
