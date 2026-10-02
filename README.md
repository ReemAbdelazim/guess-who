# Guess Who? · Seeds Congress 2026

- **`/`** is the game. Players see only the game. It has no links to admin and no manage buttons.
- **`/admin`** is the password-protected editor for people, photos, positions, questions and settings.

## Run it

Needs Node 18 or newer. There is nothing to install.

```bash
node server.js
```

Open http://localhost:3000 for the game and http://localhost:3000/admin for the editor.

Set the admin password with `ADMIN_PASSWORD`. If you don't set it, the server makes a random password each time it starts and prints it in the terminal.

```bash
ADMIN_PASSWORD="something-secret" PORT=8080 node server.js
```

## How the game works

The game secretly picks one person. Players click questions in the side panel and get a YES or NO answer. Everyone who doesn't match is ruled out automatically. You can turn that off in Admin, then Settings. Players can also click a card to rule a person out or bring them back. When they're ready, they press **Make your guess** and click a card. The board resizes itself so every person fits on a laptop screen without scrolling, even after you add or remove people.

## Admin

- **People:** name, position (the line under the name), and photo. *Get from Wikipedia* takes a name or a Wikipedia link and downloads that page's main photo. If you paste a direct image link instead, it downloads that image. *Upload file* works for your own photos. The *Photo position* slider moves the crop up or down so faces stay in frame.
- **Questions:** edit the wording, then tick everyone whose answer is YES. Everyone else answers NO.
- **Settings:** title, edition label, questions per round, and auto rule-out.
- Click **Save changes**. The game picks up your changes the next time it loads.

## Files

- `data/data.json`: all people, questions and settings.
- `uploads/`: the downloaded and uploaded photos.
- `seed.js`: rebuilds the starter list of 18 people from Wikipedia. It overwrites `data/data.json`.

## Hosting

Use any host that runs Node and keeps files on disk, such as a VPS, Render with a persistent disk, Railway with a volume, or Fly.io with a volume. If the host wipes the disk on each deploy, back up `data/` and `uploads/` first, or admin edits will be lost.

Photos come from Wikimedia Commons, and each person's source page is stored in `data.json`. Most of these images are CC-licensed and need credit if you republish them outside the game.
