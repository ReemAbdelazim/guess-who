# Guess Who? · Seeds Congress 2026

- **Game:** https://reemabdelazim.github.io/guess-who/
- **Admin:** https://reemabdelazim.github.io/guess-who/admin/

The game has no admin buttons or links. Only `/admin` can change people, photos, positions, questions and settings.

## How the game works

The game secretly picks one person. Players click questions in the side panel and get a YES or NO answer. Everyone who doesn't match is ruled out automatically. You can turn that off in Admin, then Settings. Players can also click a card to rule a person out or bring them back. When they're ready, they press **Make your guess** and click a card. The board resizes itself so every person fits on a laptop screen without scrolling, even after you add or remove people.

## Admin

The site is hosted on GitHub Pages, which can't run a server. The admin page saves by committing straight to this repository, so you sign in with a GitHub token.

**Getting a token (one time):**

1. Open https://github.com/settings/personal-access-tokens/new
2. Under **Repository access**, choose **Only select repositories** and pick `guess-who`.
3. Under **Repository permissions**, set **Contents** to **Read and write**.
4. Generate the token and paste it on the admin sign-in screen. Keep it private, because anyone with it can edit the game.

**Editing:**

- **People:** name, position (the line under the name), and photo. *Get from Wikipedia* takes a name or a Wikipedia link and pulls that page's main photo. *Upload file* uses your own photo. Photos are resized to 800px and saved in `uploads/`. The *Photo position* slider moves the crop up or down so faces stay in frame.
- **Questions:** edit the wording, then click everyone whose answer is YES. Everyone else answers NO.
- **Settings:** title, edition label, questions per round, and auto rule-out.
- Click **Save changes**. GitHub Pages republishes the site, and the game shows the update about a minute later.

## Files

- `index.html`, `game.js`, `brand.css`, `assets/`: the game and the Seeds Congress branding.
- `admin/`: the admin page.
- `data/data.json`: all people, questions and settings.
- `uploads/`: the photos.

To preview locally, run a static server in this folder (for example `python -m http.server`) and open http://localhost:8000.

Photos come from Wikimedia Commons, and each person's source page is stored in `data.json`. Most of these images are CC-licensed and need credit if you republish them outside the game.
