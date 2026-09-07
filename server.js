const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();

app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "https://www.chatlove.pro", // React frontend
    methods: ["GET", "POST"],
  },
});

const waitingUsers = [];
const pairs = new Map();
const confessions = [];
const ludoGames = new Map();
const pendingLudoInvites = new Map();
const ticTacToeGames = new Map();
const pendingTicTacToeInvites = new Map();

const LUDO_FINISHED = 58;
const LUDO_SAFE_SQUARES = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
const otherPlayer = (game, key) => game.players.find((player) => player.key !== key);
const playerFor = (game, key) => game.players.find((player) => player.key === key);
const gameFor = (key) => [...ludoGames.values()].find((game) => playerFor(game, key));
const positionOnTrack = (player, progress) => progress < 0 || progress >= 52
  ? null
  : (player.color === "red" ? progress : progress + 26) % 52;
const canMove = (game, player, tokenIndex) => {
  const progress = player.tokens[tokenIndex];
  if (progress === LUDO_FINISHED) return false;
  if (progress === -1) return game.dice === 6;
  return progress + game.dice <= LUDO_FINISHED;
};
const publicGame = (game) => ({
  id: game.id,
  room: game.room,
  status: game.status,
  turn: game.turn,
  dice: game.dice,
  winner: game.winner,
  players: game.players.map(({ key, color, name, tokens, connected }) => ({ key, color, name, tokens, connected })),
});
const emitGame = (game) => io.to(game.room).emit("ludo:state", publicGame(game));
const endGame = (game, reason) => {
  if (!game) return;
  io.to(game.room).emit("ludo:ended", { reason });
  ludoGames.delete(game.id);
};
const ticTacToeGameFor = (key) => [...ticTacToeGames.values()].find((game) => game.players.some((player) => player.key === key));
const publicTicTacToeGame = (game) => ({
  id: game.id,
  status: game.status,
  turn: game.turn,
  winner: game.winner,
  board: game.board,
  players: game.players.map(({ key, mark, name, connected }) => ({ key, mark, name, connected })),
});
const emitTicTacToeGame = (game) => io.to(game.room).emit("ttt:state", publicTicTacToeGame(game));
const endTicTacToeGame = (game, reason) => {
  if (!game) return;
  io.to(game.room).emit("ttt:ended", { reason });
  ticTacToeGames.delete(game.id);
};
const createTicTacToeGame = (first, second) => {
  const game = {
    id: `ttt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    room: "ttt-room-" + Math.random().toString(36).slice(2),
    status: "playing",
    turn: first.key,
    winner: null,
    board: Array(9).fill(null),
    players: [
      { ...first, mark: "X", connected: true },
      { ...second, mark: "O", connected: true },
    ],
    disconnectTimers: new Map(),
  };
  ticTacToeGames.set(game.id, game);
  return game;
};
const ticTacToeWinner = (board) => {
  const lines = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  return lines.find(([a, b, c]) => board[a] && board[a] === board[b] && board[a] === board[c]);
};
const ludoError = (socket, message) => socket.emit("ludo:error", { message });
const createGame = (first, second) => {
  const game = {
    id: `ludo-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    room: "ludo-room-" + Math.random().toString(36).slice(2),
    status: "playing",
    turn: first.key,
    dice: null,
    winner: null,
    players: [
      { ...first, color: "red", tokens: [-1, -1, -1, -1], connected: true },
      { ...second, color: "green", tokens: [-1, -1, -1, -1], connected: true },
    ],
    disconnectTimers: new Map(),
  };
  ludoGames.set(game.id, game);
  return game;
};

const findOrQueueStranger = (socket, userData) => {
  console.log("Finding stranger for", socket.id, userData);

  socket.data = userData || socket.data || { name: "Stranger", age: "" };

  const existingIndex = waitingUsers.findIndex((u) => u.id === socket.id);
  if (existingIndex !== -1) {
    waitingUsers.splice(existingIndex, 1);
  }

  if (waitingUsers.length > 0) {
    const stranger = waitingUsers.shift();

    pairs.set(socket.id, stranger.id);
    pairs.set(stranger.id, socket.id);

    socket.emit("matched", {
      strangerId: stranger.id,
      strangerName: stranger.name || "Stranger",
    });

    io.to(stranger.id).emit("matched", {
      strangerId: socket.id,
      strangerName: socket.data.name || "Stranger",
    });
  } else {
    waitingUsers.push({
      id: socket.id,
      ...socket.data,
    });

    socket.emit("waiting");
  }
};

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.emit("confessions", confessions);

  socket.on("add-confession", (confession) => {
    if (!confession || !confession.name || !confession.message) return;

    confessions.unshift({
      ...confession,
      id: `${Date.now()}-${Math.random()}`,
      likes: 0,
      liked: false,
      comments: [],
      createdAt: new Date().toISOString(),
    });
    confessions.splice(10);
    io.emit("confessions", confessions);
  });

  socket.on("like-confession", ({ confessionId, liked }) => {
    const confession = confessions.find((item) => item.id === confessionId);
    if (!confession) return;
    confession.likes = Math.max(0, confession.likes + (liked ? 1 : -1));
    io.emit("confessions", confessions);
  });

  socket.on("comment-confession", ({ confessionId, text }) => {
    const confession = confessions.find((item) => item.id === confessionId);
    if (!confession || !text) return;
    confession.comments.push({ id: `${Date.now()}-${Math.random()}`, text });
    io.emit("confessions", confessions);
  });

  // User wants to find a stranger
  socket.on("find-stranger", (userData) => {
    findOrQueueStranger(socket, userData);
  });

  socket.on("ludo:resume", ({ playerKey, name } = {}) => {
    if (typeof playerKey !== "string" || playerKey.length < 8) return;
    socket.data = { ...(socket.data || {}), playerKey, name: name || socket.data?.name || "Stranger" };
    const game = gameFor(playerKey);
    if (!game) return;
    const player = playerFor(game, playerKey);
    player.socketId = socket.id;
    player.connected = true;
    const timer = game.disconnectTimers.get(playerKey);
    if (timer) clearTimeout(timer);
    game.disconnectTimers.delete(playerKey);
    socket.join(game.room);
    emitGame(game);
  });

  socket.on("ttt:resume", ({ playerKey, name } = {}) => {
    if (typeof playerKey !== "string" || playerKey.length < 8) return;
    socket.data = { ...(socket.data || {}), playerKey, name: name || socket.data?.name || "Stranger" };
    const game = ticTacToeGameFor(playerKey);
    if (!game) return;
    const player = game.players.find((item) => item.key === playerKey);
    player.socketId = socket.id;
    player.connected = true;
    const timer = game.disconnectTimers.get(playerKey);
    if (timer) clearTimeout(timer);
    game.disconnectTimers.delete(playerKey);
    socket.join(game.room);
    emitTicTacToeGame(game);
  });

  socket.on("ttt:invite", () => {
    const partnerId = pairs.get(socket.id);
    if (!partnerId) return socket.emit("ttt:error", { message: "Connect to a stranger before starting a game." });
    if (ticTacToeGameFor(socket.data?.playerKey)) return socket.emit("ttt:error", { message: "You are already in a Tic-Tac-Toe game." });
    pendingTicTacToeInvites.set(partnerId, { from: socket.id, name: socket.data?.name || "Stranger" });
    io.to(partnerId).emit("ttt:invite", { name: socket.data?.name || "Stranger" });
  });

  socket.on("ttt:respond", ({ accepted } = {}) => {
    const invite = pendingTicTacToeInvites.get(socket.id);
    if (!invite) return;
    pendingTicTacToeInvites.delete(socket.id);
    if (!accepted) return io.to(invite.from).emit("ttt:declined");
    const inviter = io.sockets.sockets.get(invite.from);
    if (!inviter || pairs.get(invite.from) !== socket.id) return socket.emit("ttt:error", { message: "The chat connection has ended." });
    const game = createTicTacToeGame(
      { key: inviter.data?.playerKey, socketId: inviter.id, name: inviter.data?.name || "Stranger" },
      { key: socket.data?.playerKey, socketId: socket.id, name: socket.data?.name || "Stranger" },
    );
    if (!game.players[0].key || !game.players[1].key) {
      ticTacToeGames.delete(game.id);
      return socket.emit("ttt:error", { message: "Refresh the chat and try again." });
    }
    inviter.join(game.room);
    socket.join(game.room);
    emitTicTacToeGame(game);
  });

  socket.on("ttt:move", ({ playerKey, index } = {}) => {
    const game = ticTacToeGameFor(playerKey);
    const player = game?.players.find((item) => item.key === playerKey);
    if (!game || !player || player.socketId !== socket.id) return socket.emit("ttt:error", { message: "Game not found." });
    if (game.status !== "playing" || game.turn !== playerKey || !Number.isInteger(index) || index < 0 || index > 8 || game.board[index]) return socket.emit("ttt:error", { message: "That square is not available." });
    game.board[index] = player.mark;
    const winningLine = ticTacToeWinner(game.board);
    if (winningLine) {
      game.status = "finished";
      game.winner = playerKey;
    } else if (game.board.every(Boolean)) {
      game.status = "draw";
    } else {
      game.turn = game.players.find((item) => item.key !== playerKey).key;
    }
    emitTicTacToeGame(game);
  });

  socket.on("ttt:leave", ({ playerKey } = {}) => {
    endTicTacToeGame(ticTacToeGameFor(playerKey), "Game closed.");
  });

  socket.on("ttt:replay", ({ playerKey } = {}) => {
    const game = ticTacToeGameFor(playerKey);
    const player = game?.players.find((item) => item.key === playerKey);
    if (!game || !player || player.socketId !== socket.id) return socket.emit("ttt:error", { message: "Game not found." });
    if (game.status === "playing") return socket.emit("ttt:error", { message: "The current game is still in progress." });
    game.status = "playing";
    game.turn = game.players[0].key;
    game.winner = null;
    game.board = Array(9).fill(null);
    emitTicTacToeGame(game);
  });

  socket.on("ludo:invite", () => {
    const partnerId = pairs.get(socket.id);
    if (!partnerId) return ludoError(socket, "Connect to a stranger before starting a game.");
    if (gameFor(socket.data?.playerKey)) return ludoError(socket, "You are already in a Ludo game.");
    pendingLudoInvites.set(partnerId, { from: socket.id, to: partnerId, name: socket.data?.name || "Stranger" });
    io.to(partnerId).emit("ludo:invite", { name: socket.data?.name || "Stranger" });
  });

  socket.on("ludo:respond", ({ accepted } = {}) => {
    const invite = pendingLudoInvites.get(socket.id);
    if (!invite) return;
    pendingLudoInvites.delete(socket.id);
    if (!accepted) return io.to(invite.from).emit("ludo:declined");
    const inviter = io.sockets.sockets.get(invite.from);
    if (!inviter || pairs.get(invite.from) !== socket.id) return ludoError(socket, "The chat connection has ended.");
    const game = createGame(
      { key: inviter.data?.playerKey, socketId: inviter.id, name: inviter.data?.name || "Stranger" },
      { key: socket.data?.playerKey, socketId: socket.id, name: socket.data?.name || "Stranger" },
    );
    if (!game.players[0].key || !game.players[1].key) {
      ludoGames.delete(game.id);
      return ludoError(socket, "Refresh the chat and try again.");
    }
    inviter.join(game.room);
    socket.join(game.room);
    emitGame(game);
  });

  socket.on("ludo:roll", ({ playerKey } = {}) => {
    const game = gameFor(playerKey);
    const player = game && playerFor(game, playerKey);
    if (!game || !player || player.socketId !== socket.id) return ludoError(socket, "Game not found.");
    if (game.status !== "playing" || game.turn !== playerKey || game.dice !== null) return ludoError(socket, "It is not your turn.");
    game.dice = Math.floor(Math.random() * 6) + 1;
    emitGame(game);
    if (!player.tokens.some((_, tokenIndex) => canMove(game, player, tokenIndex))) {
      setTimeout(() => {
        if (game.status !== "playing" || game.dice === null) return;
        game.dice = null;
        game.turn = otherPlayer(game, playerKey).key;
        emitGame(game);
      }, 900);
    }
  });

  socket.on("ludo:move", ({ playerKey, tokenIndex } = {}) => {
    const game = gameFor(playerKey);
    const player = game && playerFor(game, playerKey);
    if (!game || !player || player.socketId !== socket.id) return ludoError(socket, "Game not found.");
    if (game.status !== "playing" || game.turn !== playerKey || !Number.isInteger(tokenIndex) || tokenIndex < 0 || tokenIndex > 3) return ludoError(socket, "Invalid move.");
    if (game.dice === null || !canMove(game, player, tokenIndex)) return ludoError(socket, "That token cannot move.");
    const rolled = game.dice;
    player.tokens[tokenIndex] = player.tokens[tokenIndex] === -1 ? 0 : player.tokens[tokenIndex] + rolled;
    const landed = positionOnTrack(player, player.tokens[tokenIndex]);
    if (landed !== null && !LUDO_SAFE_SQUARES.has(landed)) {
      const opponent = otherPlayer(game, playerKey);
      opponent.tokens = opponent.tokens.map((progress) => positionOnTrack(opponent, progress) === landed ? -1 : progress);
    }
    if (player.tokens.every((progress) => progress === LUDO_FINISHED)) {
      game.status = "finished";
      game.winner = playerKey;
    } else if (rolled !== 6) {
      game.turn = otherPlayer(game, playerKey).key;
    }
    game.dice = null;
    emitGame(game);
  });

  socket.on("ludo:leave", ({ playerKey } = {}) => {
    const game = gameFor(playerKey);
    if (!game) return;
    endGame(game, "Game closed.");
  });

  socket.on("ludo:replay", ({ playerKey } = {}) => {
    const game = gameFor(playerKey);
    const player = game && playerFor(game, playerKey);
    if (!game || !player || player.socketId !== socket.id) return ludoError(socket, "Game not found.");
    if (game.status === "playing") return ludoError(socket, "The current game is still in progress.");
    game.status = "playing";
    game.turn = game.players[0].key;
    game.dice = null;
    game.winner = null;
    game.players.forEach((gamePlayer) => { gamePlayer.tokens = [-1, -1, -1, -1]; });
    emitGame(game);
  });

  // Send message
  socket.on("send-message", (message) => {
    const partnerId = pairs.get(socket.id);

    if (partnerId) {
      const senderName = (socket.data && socket.data.name) ? socket.data.name : "Stranger";
      io.to(partnerId).emit("receive-message", {
        sender: senderName,
        text: message,
      });
    }
  });

  // Send image
  socket.on("send-image", (imageData) => {
    const partnerId = pairs.get(socket.id);

    if (partnerId) {
      const senderName = (socket.data && socket.data.name) ? socket.data.name : "Stranger";
      io.to(partnerId).emit("receive-image", {
        sender: senderName,
        image: imageData,
      });
    }
  });

  // Typing indicator
  socket.on("typing", () => {
    const partnerId = pairs.get(socket.id);

    if (partnerId) {
      io.to(partnerId).emit("stranger-typing");
    }
  });

  // Stopped typing
  socket.on("stopped-typing", () => {
    const partnerId = pairs.get(socket.id);

    if (partnerId) {
      io.to(partnerId).emit("stranger-stopped-typing");
    }
  });

  // Next stranger
  socket.on("next-stranger", (userData) => {
    endGame(gameFor(socket.data?.playerKey), "The chat connection changed.");
    endTicTacToeGame(ticTacToeGameFor(socket.data?.playerKey), "The chat connection changed.");
    const partnerId = pairs.get(socket.id);

    if (partnerId) {
      io.to(partnerId).emit("stranger-left");

      pairs.delete(partnerId);
      pairs.delete(socket.id);
    }

    socket.emit("search-again");
    findOrQueueStranger(socket, userData || socket.data || { name: "Stranger", age: "" });
  });

  // Disconnect user
  socket.on("disconnect-user", () => {
    endGame(gameFor(socket.data?.playerKey), "The chat connection ended.");
    endTicTacToeGame(ticTacToeGameFor(socket.data?.playerKey), "The chat connection ended.");
    const partnerId = pairs.get(socket.id);

    if (partnerId) {
      io.to(partnerId).emit("stranger-left");

      pairs.delete(partnerId);
      pairs.delete(socket.id);

      waitingUsers.push({ id: partnerId });
    }
  });

  // Disconnect
  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);

    const game = gameFor(socket.data?.playerKey);
    if (game) {
      const player = playerFor(game, socket.data.playerKey);
      if (player && player.socketId === socket.id) {
        player.connected = false;
        const timer = setTimeout(() => {
          if (player.connected) return;
          io.to(game.room).emit("ludo:ended", { reason: "The other player disconnected." });
          ludoGames.delete(game.id);
        }, 30000);
        game.disconnectTimers.set(socket.data.playerKey, timer);
        emitGame(game);
      }
    }

    const ticTacToeGame = ticTacToeGameFor(socket.data?.playerKey);
    if (ticTacToeGame) {
      const player = ticTacToeGame.players.find((item) => item.key === socket.data.playerKey);
      if (player && player.socketId === socket.id) {
        player.connected = false;
        const timer = setTimeout(() => {
          if (player.connected) return;
          endTicTacToeGame(ticTacToeGame, "The other player disconnected.");
        }, 30000);
        ticTacToeGame.disconnectTimers.set(socket.data.playerKey, timer);
        emitTicTacToeGame(ticTacToeGame);
      }
    }

    const partnerId = pairs.get(socket.id);

    if (partnerId) {
      io.to(partnerId).emit("stranger-left");

      pairs.delete(partnerId);
      pairs.delete(socket.id);
    }

    const index = waitingUsers.findIndex(
      (u) => u.id === socket.id
    );

    if (index !== -1) {
      waitingUsers.splice(index, 1);
    }

    // Clean up socket data
    delete socket.data;
  });
});

app.get("/", (req, res) => {
  res.send("Server running...");
});

server.listen(5000, () => {
  console.log("Server running on port 5000");
});