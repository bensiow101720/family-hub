# Family Hub

A private family scheduling app: calendar, weather, chores/study/pet-care planner,
reminders, shared lists, and shared files — built for Ben, Inez, Miya, and Tyler.

## Running locally
    npm start
Then open http://localhost:3000

## Deploying
Deploy this whole folder to Railway (see setup chat for step-by-step instructions).
No external packages are required — it only uses Node.js's built-in modules.

## Data storage note
Data is stored in data/db.json on the server. On Railway's free tier this file
resets if the app redeploys — add a Railway Volume (see instructions) to make
it permanent.

## Spotify playlist import (Cool Stuff)
Lets you paste a Spotify playlist link and browse its track list/cover art
inside the app — it reads public metadata only via Spotify's Web API and
never downloads or converts audio; tapping a track opens it on Spotify.
Requires your own free Spotify app credentials, set as environment variables:

| Variable | Purpose |
|---|---|
| `SPOTIFY_CLIENT_ID` | From a Spotify app at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) |
| `SPOTIFY_CLIENT_SECRET` | Same app, "Client secret" |

No redirect URI or user login is needed — this only reads public playlist
data via Spotify's app-level Client Credentials flow. Without these set,
the import form shows a clear "not configured" message instead of failing
silently.
