# SUSTAINI-FEUD

A real-time, sustainability-themed game show for Sustainicity. One host runs the show from a laptop/projector and up to **40 participants** join from their phones using a 5-character room code.

## What this version does

- Supports up to **40 participants per room** (minimum 2 to start).
- Automatically shuffles the question bank and asks the next question when the host starts or advances a round. The host never selects a question manually.
- Questions are not repeated until the current shuffled question cycle has been used. The next cycle is shuffled again and avoids repeating the immediately previous question.
- The first participant to buzz gets the answer turn. If their answer is marked wrong, the buzzer reopens for participants who have not yet answered that question.
- A participant gets one attempt per question. A correct answer ends the round.
- The host judges the typed response by clicking the matching unrevealed answer, or marks it wrong. A 20-second answer timer and 30-second host-review timer prevent a turn from hanging indefinitely.
- Correct answers award their listed board points: **50 / 40 / 30 / 20 / 10 / 5**.
- Wrong answers deduct 10 points, but scores cannot fall below zero.
- Live roster and leaderboard update across connected screens.
- Server-side validation checks room membership, host authority, game state, participant turns, payload shape, answer availability, duplicate scoring and room capacity.
- Room state is in memory. Rooms expire after two hours of inactivity; a disconnected host's room closes after a 10-minute grace period.

## Run locally

Requirements: Node.js 18+.

```bash
npm install
npm start
```

Open `http://localhost:3000`. Create a room on the host device and share the room code with participants. All devices need to access the same deployed URL or local network host.

## Deploy to GitHub + Render

1. Upload the project while preserving the folder structure.
2. Connect the repository to Render as a Web Service.
3. Build command: `npm install`
4. Start command: `npm start`
5. Use one running server instance for the live game. This version stores room state in memory, so restarts clear active rooms and multiple server instances will not share game state.

## Host controls

- **Start Showdown** automatically selects a shuffled question and opens the buzzer.
- Click an unrevealed answer tile after a participant submits a response to award its points.
- **Mark Wrong** deducts 10 points (not below zero) and reopens the buzzer for participants who have not yet tried.
- **Next Random Question** starts the next question after the current round ends.
- **Reset Game** clears scores and returns the room to the lobby.

## Operational notes

- A minimum of two participants is required to start or continue.
- Late joins are closed once the host starts the game, preventing a round's player pool from changing unexpectedly.
- A player who disconnects is removed from the active roster. If they held the answer turn, the buzzer reopens for eligible participants.
- The host's browser receives the answer bank; participant room updates contain the question and public game state, not the hidden answers.
- The `/health` endpoint reports server health, room count, question count and the configured participant limit.
- Before an event, rehearse one full round with multiple phones and verify the deployed service. In-memory games do not survive a server restart.
