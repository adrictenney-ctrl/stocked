# Stocked

A shared pantry and shopping list. Make a list, add the people in your household, set how much of each thing you like to keep, and count the pantry once a week. Anything that's short goes onto the shopping list automatically, and shoppers check things off as they pick them up.

## Roles

| Role | Can do |
| --- | --- |
| **Manager** | Everything. Adds or removes people, changes roles, renames or deletes the list. The person who made the list is always a manager. |
| **Stocker** | Adds, edits and removes pantry items, takes the weekly count, and can remove anything from the shopping list. |
| **Shopper** | Sees the list, marks things picked up, adds requests. |

## How the weekly count works

1. Each pantry item has an **amount to keep** (for example, keep 2 gal of milk).
2. A manager or stocker opens **Count** and enters what's on hand.
3. When the count is saved, Stocked compares each item to its amount to keep. Anything short goes onto the **Shop** tab, replacing last week's count items that nobody picked up yet. Requests people added by hand stay put.
4. When a shopper checks off an item, its amount is added back to the pantry.
5. The **Count** tab shows when the next count is due (every 7 days by default; you can change it in People → List settings).

## Run it on your computer

You need [Node.js](https://nodejs.org). From this folder, run:

```bash
node dev-server.mjs
```

Then open http://localhost:5173.

The app uses your Firebase project (set in `js/firebase-config.js`).

To try things without touching real data, open http://localhost:5173/?demo instead. That's **demo mode**: accounts and lists are saved in your browser only, and new demo accounts start with a sample pantry. You can add `jordan@example.com` on the People tab to see how adding someone works.

## Connect Firebase

1. Go to https://console.firebase.google.com and create a project.
2. **Build → Authentication → Get started**, then turn on **Email/Password**.
3. **Build → Firestore Database → Create database** (production mode is fine, since the rules below lock it down).
4. **Project settings → General → Your apps → Web (`</>`)**: register an app and copy the `firebaseConfig` object.
5. Paste those values into `js/firebase-config.js`. Demo mode turns off automatically.
6. Publish the security rules. Either paste the contents of `firestore.rules` into **Firestore → Rules** and click Publish, or use the CLI:

```bash
npm install -g firebase-tools
```

```bash
firebase login
```

```bash
firebase use --add
```

```bash
firebase deploy --only firestore:rules
```

## Put it online (Firebase Hosting)

After the steps above:

```bash
firebase deploy --only hosting
```

Firebase prints your site's address (something like `https://your-project.web.app`). Everyone on the list can use that link.

## Files

- `index.html`, `styles.css`: page shell and all the styling (brown, white and beige; light and dark mode)
- `js/app.js`: screens and behavior
- `js/backend-firebase.js`: Firebase Auth and Firestore
- `js/backend-demo.js`: the in-browser demo backend (same functions, no server)
- `firestore.rules`: who can read and change what, by role

## Data layout (Firestore)

```
users/{uid}                 name, email, emailLower
lists/{listId}              name, emoji, ownerId, members{uid: {role, name, email}}, memberIds[], lastCountAt, countEveryDays
lists/{listId}/items        name, category, unit, target (amount to keep), current (on hand)
lists/{listId}/shopping     name, qty, unit, category, source (inventory | manual), itemId, status (needed | picked), addedBy, pickedBy
lists/{listId}/counts       takenAt, takenBy, results[{itemId, name, counted, target, short}]
```
