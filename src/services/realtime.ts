import type { Server as HttpServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { env } from '../config/env.js';

/**
 * Live updates over Socket.IO. Each signed-in app joins the room `user:<id>`
 * and receives:
 * - `notification` — every in-app notification as it's created (new
 *   applicant, proposal, status change…), so screens can refresh themselves;
 * - `message` — a new chat message `{ conversationId, message }`;
 * - `call:incoming` / `call:accepted` / `call:declined` / `call:ended`.
 */
let io: Server | undefined;

export function initRealtime(server: HttpServer) {
  io = new Server(server, { path: '/api/v1/socket.io', cors: { origin: '*' } });
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token ?? socket.handshake.query?.token;
    try {
      const payload = jwt.verify(String(token ?? ''), env.jwtSecret) as { sub: string };
      socket.data.userId = payload.sub;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });
  io.on('connection', (socket) => {
    socket.join(`user:${socket.data.userId}`);
  });
}

/** Sends an event to every device the user is connected on. */
export function emitTo(userId: unknown, event: string, data: unknown) {
  io?.to(`user:${String(userId)}`).emit(event, data);
}
