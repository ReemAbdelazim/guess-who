# Guess Who? · Seeds Congress 2026

- **Game:** https://reemabdelazim.github.io/guess-who/
- **Admin:** https://reemabdelazim.github.io/guess-who/admin/

The game has no admin buttons or links. Only `/admin` can change people, photos, positions, questions and settings.

## How to play

Two players compete head-to-head, live, from two different laptops, to work out each other's secret person. Every person on the board is a prominent Muslim figure, historical or contemporary.

1. One player opens the game and clicks **Start a new game**. They get a 4-letter game code and a link to send to the other player.
2. Each player chooses **Player 1** or **Player 2** and types their name. Each player then has their own link (`?game=CODE&p=1` or `&p=2`). You can change your name at the top of the screen at any time.
3. Each player secretly picks a person from the board and locks them in. Click the **i** on a card to learn about someone. Before the round, either player can change the time limit (5 minutes by default).
4. When both are locked in, the round starts. The timer starts with the first question, and both screens show the same clock. Either player can pause it or add a minute.
5. Players take turns. You type a yes-or-no question (or pick an example). It appears on the other player's screen, they tap **Yes** or **No**, and then it's their turn. There's no limit on questions.
6. Click a card to rule that person out. Click it again to bring them back.
7. When you're sure, or when time runs out, lock in your guess.
8. Once both players have guessed, both secret people are revealed on both screens. If both guessed right, both win. Click **Play another round** to keep score across rounds.

Each player's secret person stays on their own laptop until both have guessed. If a laptop refreshes or reconnects, the player rejoins the same game automatically.

## Admin

The site is hosted on GitHub Pages, which can't run a server. The admin page saves by committing straight to this repository, so you sign in with a GitHub token.

**Getting a token (one time):**

1. Open https://github.com/settings/personal-access-tokens/new
2. Under **Repository access**, choose **Only select repositories** and pick `guess-who`.
3. Under **Repository permissions**, set **Contents** to **Read and write**.
4. Generate the token and paste it on the admin sign-in screen. Keep it private, because anyone with it can edit the game.

**Editing:**

- **People:** name, position (the line under the name), the facts players see when they click **i**, and photo. *Get from Wikipedia* takes a name or a Wikipedia link and pulls that page's main photo. *Upload file* uses your own photo. Photos are resized to 800px and saved in `uploads/`. The *Photo position* slider moves the crop up or down so faces stay in frame.
- **Example questions:** ideas shown to teams during a round. Teams can ask any yes-or-no question they like.
- **Settings:** title, edition label, and the default time to ask questions.
- Click **Save changes**. GitHub Pages republishes the site, and the game shows the update about a minute later.

## Files

- `index.html`, `game.js`, `brand.css`, `assets/`: the game and the Seeds Congress branding.
- `admin/`: the admin page.
- `data/data.json`: all people, facts, example questions and settings.
- `uploads/`: the photos.
- `firebase-config.js`, `database.rules.json`, `firebase.json`: the live-game connection to the Firebase project `seeds-guess-who` (Realtime Database). Games are stored under `/games/CODE`.

To preview locally, run a static server (the live games still go through Firebase) in this folder (for example `python -m http.server`) and open http://localhost:8000.

Photos come from Wikimedia Commons, and each person's source page is stored in `data.json`. Most of these images are CC-licensed and need credit if you republish them outside the game.
