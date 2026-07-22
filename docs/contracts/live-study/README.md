# ProxiNG Live Study Contract v1

This contract is the frontend and backend integration boundary for Exam Prep Live Study.

## Common envelopes

Success: `{ "success": true, "data": ... }`

Error: `{ "success": false, "error": "...", "code": "LIVE_STUDY_..." }`

## REST routes

| Method | Path | Success | Access |
|---|---|---:|---|
| GET | `/api/learn/rooms/:roomId/live-study/availability` | 200 | room_member |
| POST | `/api/learn/rooms/:roomId/live-study/sessions/:sessionId/cancel` | 200 | room_host |
| POST | `/api/learn/rooms/:roomId/live-study/sessions/:sessionId/end` | 200 | room_host |
| POST | `/api/learn/rooms/:roomId/live-study/sessions/:sessionId/presence` | 200 | room_member |
| POST | `/api/learn/rooms/:roomId/live-study/sessions/:sessionId/start` | 200 | room_host |
| POST | `/api/learn/rooms/:roomId/live-study/sessions/:sessionId/token` | 200 | room_member |
| GET | `/api/learn/rooms/:roomId/live-study/sessions/:sessionId` | 200 | room_member |
| GET | `/api/learn/rooms/:roomId/live-study/sessions` | 200 | room_member |
| POST | `/api/learn/rooms/:roomId/live-study/sessions` | 201 | room_host |

## Session lifecycle

`scheduled -> open -> closed`

`scheduled -> cancelled`

Closed and cancelled sessions are terminal.

## Publishing policy

- Hosts may publish media and data.
- Members may subscribe and publish data.
- Members may not publish microphone, camera, or screen media.

## Realtime contract

Every event contains server-owned `version`, `product`, `roomId`, and `event` fields.

Session events include a `session` object. Presence events include a `presence` object.

## Explicitly unsupported

- Waiting rooms
- Recording
- Dynamic speaker promotion
- Remote participant muting
- Provider-verified presence

## Frontend requirement

Tokens remain in memory only. The frontend must provide truthful loading, empty, error, offline, access-denied, disabled, provider-unavailable, capacity, conflict, expiry, and reconnection states.

The machine-readable contract is `v1.json`.
