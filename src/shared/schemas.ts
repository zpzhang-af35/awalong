import { z } from "zod";
import { ROLE_IDS } from "./types";

export const roleIdSchema = z.enum(ROLE_IDS);

export const createRoomSchema = z.object({
  name: z.string().trim().min(1).max(18)
});

export const joinRoomSchema = z.object({
  code: z.string().trim().length(6).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(1).max(18),
  rejoinToken: z.string().optional()
});

export const setConfigSchema = z.object({
  maxPlayers: z.number().int().min(5).max(10),
  roles: z.array(roleIdSchema).min(5).max(10)
});

export const proposeTeamSchema = z.object({
  playerIds: z.array(z.string()).min(1).max(5)
});

export const voteSchema = z.object({
  approve: z.boolean()
});

export const questSchema = z.object({
  fail: z.boolean()
});

export const assassinateSchema = z.object({
  playerId: z.string()
});

export const chatSchema = z.object({
  text: z.string().trim().min(1).max(400)
});
