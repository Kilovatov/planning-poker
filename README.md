# Planning Poker (GH Pages)

A lightweight Planning Poker web app you can deploy on GitHub Pages. Real-time sync is powered by Firebase (no server needed).

## Features
- Card deck: `0.5, 1, 2, 3, 5, 8, 13, 20, ☕ (coffee), ∞`
- Join/create rooms via `?room=ID` query param
- Hidden votes until **Reveal** _or_ when everyone has voted
- Auto presence and participant list
- Results panel with **min / avg / max** (ignores ☕ and ∞)
- **Manual evaluation** to enter votes for people who can't vote
- **Reset** to clear all votes

## 1) Create a Firebase project (once)
1. Go to <https://console.firebase.google.com/> → create project.
2. Add a **Web App** → register app (no hosting needed) → copy the config snippet.
3. Enable **Authentication → Sign-in method → Anonymous**.
4. Enable **Firestore Database** (start in **Test mode** for quick start).

### (Optional) Firestore Security Rules (basic)
For a demo, test mode is easiest. For a simple lock-down that allows anyone to read/write existing rooms, you can start with:
```
// !!! Adapt for production use !!!
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /rooms/{roomId} {
      allow read, write: if true; // public demo
      match /participants/{uid} {
        allow read, write: if true; // public demo
      }
    }
  }
}
```
> In real deployments, you should restrict writes to authenticated users and possibly validate fields.

## 2) Configure the app
1. In this repo/folder, copy `config.example.js` to `config.js` and paste your Firebase Web config values.
2. Commit and push.

## 3) Deploy to GitHub Pages
- If your repo is public: go to **Settings → Pages**, select the **main** branch and root (`/`) folder, save.
- Your site will be available at the Pages URL in a minute.

## 4) Use it
- Create a room with the **New Room** button or open a URL like:
  `https://<your-gh-username>.github.io/<repo>/?room=demo123`
- Enter your **Name** and hit **Save**.
- Click a card to vote. Votes stay hidden until **Reveal** or until everyone has voted.
- Use **Manual Evaluate** to fill in missing votes (must match one of the deck values).

## Tech Notes
- Pure front-end (no build step) → ideal for GH Pages.
- Real-time sync with Firebase Firestore (anonymous auth).
- Presence via `lastSeen` heartbeat (1-minute away threshold).

