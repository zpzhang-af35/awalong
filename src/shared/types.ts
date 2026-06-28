export const ROLE_IDS = [
  "Merlin",
  "Percival",
  "LoyalServant",
  "Assassin",
  "Morgana",
  "Mordred",
  "Oberon",
  "Minion"
] as const;

export type RoleId = (typeof ROLE_IDS)[number];
export type Allegiance = "good" | "evil";
export type Phase =
  | "lobby"
  | "teamBuild"
  | "teamVote"
  | "quest"
  | "assassination"
  | "ended";
export type Winner = "good" | "evil";

export interface RoleInfo {
  id: RoleId;
  allegiance: Allegiance;
  displayName: string;
  standardName: string;
  shortDescription: string;
  canFailQuest: boolean;
}

export interface RoomConfig {
  maxPlayers: number;
  roles: RoleId[];
}

export interface PlayerPublic {
  id: string;
  name: string;
  seat: number;
  ready: boolean;
  connected: boolean;
  isHost: boolean;
  roleId?: RoleId;
}

export interface QuestResult {
  round: number;
  team: string[];
  failCount: number;
  successCount: number;
  requiredFails: number;
  passed: boolean;
}

export interface VoteHistoryItem {
  round: number;
  attempt: number;
  leaderId: string;
  team: string[];
  votes: Record<string, boolean>;
  approved: boolean;
}

export interface ChatMessage {
  id: string;
  kind: "chat" | "system";
  playerId?: string;
  playerName?: string;
  text: string;
  createdAt: number;
}

export interface Scoreboard {
  [playerId: string]: number;
}

export interface PublicRoomSnapshot {
  code: string;
  config: RoomConfig;
  scoreboard: Scoreboard;
  players: PlayerPublic[];
  phase: Phase;
  leaderId?: string;
  round: number;
  rejectionCount: number;
  proposedTeam: string[];
  teamVotes?: Record<string, boolean>;
  teamVoteSubmitted: string[];
  questSubmitted: string[];
  questResults: QuestResult[];
  voteHistory: VoteHistoryItem[];
  winner?: Winner;
  winReason?: string;
  assassinId?: string;
  assassinatedPlayerId?: string;
  messages: ChatMessage[];
}

export interface PrivateState {
  playerId: string;
  roleId?: RoleId;
  roleInfo?: RoleInfo;
  knownGoodIds: string[];
  knownEvilIds: string[];
  percivalCandidateIds: string[];
  rejoinToken: string;
}

export interface CreateRoomPayload {
  name: string;
}

export interface JoinRoomPayload {
  code: string;
  name: string;
  rejoinToken?: string;
}

export interface SetConfigPayload {
  maxPlayers: number;
  roles: RoleId[];
}

export interface PlayerActionPayload {
  playerId: string;
}

export interface ProposeTeamPayload {
  playerIds: string[];
}

export interface VotePayload {
  approve: boolean;
}

export interface QuestPayload {
  fail: boolean;
}

export interface ChatPayload {
  text: string;
}
