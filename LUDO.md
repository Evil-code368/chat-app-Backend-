# ChatLove Ludo integration

## Structure

- `server.js`: authoritative Ludo registry and Socket.IO handlers.
- `ChatLove-Frontend-/src/Component/Games.jsx`: invite modal, board, dice, and token controls.
- `ChatLove-Frontend-/src/Component/Anonymous-chat.jsx`: renders `Games` inside the existing chat header.

## Flow

1. `Random-chat.jsx` matches two strangers as it already does.
2. `Anonymous-chat.jsx` mounts `Games`, which creates a tab-scoped `ludoPlayerKey` and emits `ludo:resume`.
3. Player one presses `Play Ludo`; the server sends `ludo:invite` to the paired socket.
4. The second player accepts. The server creates a private Socket.IO room, assigns red/green, and emits the initial `ludo:state`.
5. The client only displays server state. Dice values are generated on the server and every move is checked there.

## Socket.IO events

| Direction | Event | Payload |
| --- | --- | --- |
| client -> server | `ludo:resume` | `{ playerKey, name }` |
| client -> server | `ludo:invite` | none |
| server -> client | `ludo:invite` | `{ name }` |
| client -> server | `ludo:respond` | `{ accepted }` |
| server -> client | `ludo:declined` | none |
| server -> room | `ludo:state` | serialized game state |
| client -> server | `ludo:roll` | `{ playerKey }` |
| client -> server | `ludo:move` | `{ playerKey, tokenIndex }` |
| server -> client | `ludo:error` | `{ message }` |
| client -> server | `ludo:leave` | `{ playerKey }` |
| server -> room | `ludo:ended` | `{ reason }` |

## Rules enforced by the backend

- Four tokens per player start at `-1` (base), use progress `0..57`, and are home at `58`.
- A token leaves base only on a six; a six keeps the turn.
- Tokens cannot move beyond home.
- Opponents are captured when landing on the same non-safe track square.
- Safe squares are `0, 8, 13, 21, 26, 34, 39, 47`.
- A player wins after all four tokens reach home.
- A disconnected player can resume with the same session key for 30 seconds. The game is then expired and the other player is notified.

## Deployment checklist

1. Set the frontend `VITE_API_URL` to the public Socket.IO backend URL.
2. Add the production frontend origin to the backend CORS allow-list. The current server uses `https://www.chatlove.pro`.
3. Run the backend with `npm start` and the frontend with `npm run build` followed by the static hosting deployment.
4. For multiple backend instances, add a Socket.IO Redis adapter and a shared game store before horizontal scaling. The current in-memory registry is correct for one process only.
5. Use sticky sessions at the load balancer when long-polling is enabled, or configure WebSocket-only transport consistently across the deployment.
