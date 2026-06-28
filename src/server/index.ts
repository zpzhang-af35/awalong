import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { Server, type Socket } from "socket.io";
import {
  assassinateSchema,
  chatSchema,
  createRoomSchema,
  joinRoomSchema,
  proposeTeamSchema,
  questSchema,
  setConfigSchema,
  voteSchema
} from "../shared/schemas";
import { GameError, RoomStore } from "./roomStore";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../..");
const port = Number(process.env.PORT ?? 3001);
const clientOrigin = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";

const app = Fastify({ logger: true });
await app.register(cors, {
  origin: process.env.NODE_ENV === "production" ? true : clientOrigin,
  credentials: true
});

const distDir = path.join(rootDir, "dist");
if (process.env.NODE_ENV === "production") {
  await app.register(fastifyStatic, {
    root: distDir,
    prefix: "/"
  });
  app.setNotFoundHandler((_request, reply) => {
    reply.sendFile("index.html");
  });
}

app.get("/health", async () => ({ ok: true }));

const io = new Server(app.server, {
  cors: {
    origin: process.env.NODE_ENV === "production" ? true : clientOrigin,
    credentials: true
  }
});

const store = new RoomStore();

function emitRoom(roomCode: string): void {
  const room = store.getRoom(roomCode);
  const snapshot = store.publicSnapshot(room);
  io.to(room.code).emit("roomSnapshot", snapshot);
  for (const player of snapshot.players) {
    const internalRoom = store.getRoom(room.code);
    const socketId = internalRoom.players.find((candidate) => candidate.id === player.id)?.socketId;
    if (!socketId) {
      continue;
    }
    io.to(socketId).emit("privateState", store.privateState(internalRoom, player.id));
  }
}

function reportError(socket: Socket, error: unknown): void {
  const message = error instanceof GameError || error instanceof Error ? error.message : "操作失败";
  socket.emit("gameError", message);
}

io.on("connection", (socket) => {
  socket.on("createRoom", (payload, ack) => {
    try {
      const data = createRoomSchema.parse(payload);
      const { room, player } = store.createRoom(data.name, socket.id);
      socket.data.roomCode = room.code;
      socket.data.playerId = player.id;
      socket.join(room.code);
      emitRoom(room.code);
      ack?.({ ok: true, roomCode: room.code, playerId: player.id, rejoinToken: player.token });
    } catch (error) {
      reportError(socket, error);
      ack?.({ ok: false, error: error instanceof Error ? error.message : "操作失败" });
    }
  });

  socket.on("joinRoom", (payload, ack) => {
    try {
      const data = joinRoomSchema.parse(payload);
      const { room, player } = store.joinRoom(data.code, data.name, socket.id, data.rejoinToken);
      socket.data.roomCode = room.code;
      socket.data.playerId = player.id;
      socket.join(room.code);
      emitRoom(room.code);
      ack?.({ ok: true, roomCode: room.code, playerId: player.id, rejoinToken: player.token });
    } catch (error) {
      reportError(socket, error);
      ack?.({ ok: false, error: error instanceof Error ? error.message : "操作失败" });
    }
  });

  socket.on("setConfig", (payload) => {
    try {
      const data = setConfigSchema.parse(payload);
      const room = store.getRoom(socket.data.roomCode);
      store.setConfig(room, socket.data.playerId, data);
      emitRoom(room.code);
    } catch (error) {
      reportError(socket, error);
    }
  });

  socket.on("setReady", () => {
    try {
      const room = store.getRoom(socket.data.roomCode);
      store.setReady(room, socket.data.playerId);
      emitRoom(room.code);
    } catch (error) {
      reportError(socket, error);
    }
  });

  socket.on("startGame", () => {
    try {
      const room = store.getRoom(socket.data.roomCode);
      store.startGame(room, socket.data.playerId);
      emitRoom(room.code);
    } catch (error) {
      reportError(socket, error);
    }
  });

  socket.on("proposeTeam", (payload) => {
    try {
      const data = proposeTeamSchema.parse(payload);
      const room = store.getRoom(socket.data.roomCode);
      store.proposeTeam(room, socket.data.playerId, data.playerIds);
      emitRoom(room.code);
    } catch (error) {
      reportError(socket, error);
    }
  });

  socket.on("castTeamVote", (payload) => {
    try {
      const data = voteSchema.parse(payload);
      const room = store.getRoom(socket.data.roomCode);
      store.castTeamVote(room, socket.data.playerId, data.approve);
      emitRoom(room.code);
    } catch (error) {
      reportError(socket, error);
    }
  });

  socket.on("submitQuestCard", (payload) => {
    try {
      const data = questSchema.parse(payload);
      const room = store.getRoom(socket.data.roomCode);
      store.submitQuestCard(room, socket.data.playerId, data.fail);
      emitRoom(room.code);
    } catch (error) {
      reportError(socket, error);
    }
  });

  socket.on("assassinate", (payload) => {
    try {
      const data = assassinateSchema.parse(payload);
      const room = store.getRoom(socket.data.roomCode);
      store.assassinate(room, socket.data.playerId, data.playerId);
      emitRoom(room.code);
    } catch (error) {
      reportError(socket, error);
    }
  });

  socket.on("sendChat", (payload) => {
    try {
      const data = chatSchema.parse(payload);
      const room = store.getRoom(socket.data.roomCode);
      store.sendChat(room, socket.data.playerId, data.text);
      emitRoom(room.code);
    } catch (error) {
      reportError(socket, error);
    }
  });

  socket.on("restartGame", () => {
    try {
      const room = store.getRoom(socket.data.roomCode);
      store.restartGame(room, socket.data.playerId);
      emitRoom(room.code);
    } catch (error) {
      reportError(socket, error);
    }
  });

  socket.on("endGameEarly", () => {
    try {
      const room = store.getRoom(socket.data.roomCode);
      store.endGameEarly(room, socket.data.playerId);
      emitRoom(room.code);
    } catch (error) {
      reportError(socket, error);
    }
  });

  socket.on("disconnect", () => {
    const room = store.disconnect(socket.id);
    if (room) {
      emitRoom(room.code);
    }
  });
});

await app.listen({ port, host: "0.0.0.0" });
