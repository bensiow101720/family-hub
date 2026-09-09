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
