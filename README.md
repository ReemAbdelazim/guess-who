# Guess Who? · Seeds Congress 2026

- **Game:** https://reemabdelazim.github.io/guess-who/
- **Admin:** https://reemabdelazim.github.io/guess-who/admin/

The game has no admin buttons or links. Only `/admin` can change people, photos, positions, questions and settings.

## How to play

Two teams compete head-to-head to work out each other's secret person. Every person on the board is a prominent Muslim figure, historical or contemporary. Each team plays on its own laptop with the game open. The two laptops don't need to be connected.

1. Each team secretly chooses one person from the board and locks them in. That's who the other team has to guess.
2. Don't know someone? Click the **i** on their card for a short bio and a few facts.
3. Start the timer. Teams take turns asking the other team one yes-or-no question at a time. There's no limit on how many questions you ask.
4. Click a card to rule that person out. Click it again to bring them back.
5. Each team gets 5 minutes in total to ask questions. Facilitators can change the time with the − and + buttons before a round, or add a minute during one.
6. When you're sure, or when time runs out, lock in your guess.
7. Both teams reveal their secret person. If both teams guess correctly, both teams win.

If the page is refreshed by accident, the round picks up where it left off.

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

To preview locally, run a static server in this folder (for example `python -m http.server`) and open http://localhost:8000.

Photos come from Wikimedia Commons, and each person's source page is stored in `data.json`. Most of these images are CC-licensed and need credit if you republish them outside the game.
