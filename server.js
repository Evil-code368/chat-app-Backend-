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

  // User wants to find a stranger
  socket.on("find-stranger", (userData) => {
    findOrQueueStranger(socket, userData);
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