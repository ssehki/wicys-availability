# WiCyS Eboard Availability

A When2Meet-style availability poll for the Women in Cybersecurity eboard.

- **Make a poll** for specific dates (one-time meetings or events) or days of the week (a recurring weekly meeting).
- **Share the link** in the gc. Everyone enters their name and clicks and drags over the times they're free.
- **The group heatmap** shows how many people are free at each time. Hover or tap a cell to see who's in and who's out.
- **Best times** lists the time blocks that work for the most people, with a minimum length you choose (30 min up to 3 hrs), and shows who can't make each one.
- Tap a name under "Who's responded" to leave that person out of the results, for example to plan an event that only needs part of the board.

There are no logins. Anyone can use the same name on another device to edit their response.

## How it works

It's a static site on GitHub Pages. Responses are stored in a free Firebase Realtime Database and update live for everyone.

| File | What it is |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | The site |
| `firebase-config.js` | The Firebase web config. Its values are public identifiers, not secrets. |
| `database.rules.json` | Database security rules. Paste them into Firebase → Realtime Database → Rules. |

If `firebase-config.js` is left as `null`, the site runs in **demo mode** and saves only to your own browser.

## Managing polls

To delete an old poll, open the Firebase console → Realtime Database → `polls`, then delete that poll's entry.
