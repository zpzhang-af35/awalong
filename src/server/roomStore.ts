import { randomBytes } from "node:crypto";
import {
  computePrivateState,
  describeWinner,
  evaluateQuest,
  evaluateWinner,
  getAllegiance,
  getDefaultConfig,
  getDefaultRoles,
  getRequiredFails,
  getTeamSize,
  ROLE_INFO,
  validateRoleSet
} from "../shared/rules";
import type {
  ChatMessage,
  Phase,
  PlayerPublic,
  PrivateState,
  PublicRoomSnapshot,
  QuestResult,
  RoleId,
  RoomConfig,
  Scoreboard,
  VoteHistoryItem,
  Winner
} from "../shared/types";

export interface PlayerInternal {
  id: string;
  token: string;
  name: string;
  seat: number;
  ready: boolean;
  connected: boolean;
  socketId?: string;
  roleId?: RoleId;
}

export interface RoomInternal {
  code: string;
  hostId: string;
  config: RoomConfig;
  scoreboard: Scoreboard;
  players: PlayerInternal[];
  phase: Phase;
  leaderSeat: number;
  round: number;
  rejectionCount: number;
  proposedTeam: string[];
  teamVotes: Record<string, boolean>;
  questSubmissions: Record<string, boolean>;
  questResults: QuestResult[];
  voteHistory: VoteHistoryItem[];
  winner?: Winner;
  winReason?: string;
  assassinId?: string;
  assassinatedPlayerId?: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface JoinResult {
  room: RoomInternal;
  player: PlayerInternal;
}

const ROOM_TTL_MS = 6 * 60 * 60 * 1000;

function makeId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}

function makeCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let index = 0; index < 6; index += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function now(): number {
  return Date.now();
}

function sanitizeName(name: string): string {
  return name.trim().slice(0, 18);
}

export class GameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GameError";
  }
}

export class RoomStore {
  private rooms = new Map<string, RoomInternal>();

  createRoom(name: string, socketId: string): JoinResult {
    this.cleanup();
    let code = makeCode();
    while (this.rooms.has(code)) {
      code = makeCode();
    }

    const player: PlayerInternal = {
      id: makeId("p"),
      token: makeId("rt"),
      name: sanitizeName(name),
      seat: 0,
      ready: false,
      connected: true,
      socketId
    };

    const room: RoomInternal = {
      code,
      hostId: player.id,
      config: getDefaultConfig(5),
      scoreboard: { [player.id]: 0 },
      players: [player],
      phase: "lobby",
      leaderSeat: 0,
      round: 0,
      rejectionCount: 0,
      proposedTeam: [],
      teamVotes: {},
      questSubmissions: {},
      questResults: [],
      voteHistory: [],
      messages: [],
      createdAt: now(),
      updatedAt: now()
    };

    this.rooms.set(code, room);
    this.addSystemMessage(room, `${player.name} 创建了代码评审室。`);
    return { room, player };
  }

  joinRoom(code: string, name: string, socketId: string, rejoinToken?: string): JoinResult {
    this.cleanup();
    const room = this.getRoom(code);
    const existingByToken = rejoinToken
      ? room.players.find((player) => player.token === rejoinToken)
      : undefined;

    if (existingByToken) {
      existingByToken.name = sanitizeName(name) || existingByToken.name;
      existingByToken.socketId = socketId;
      existingByToken.connected = true;
      this.touch(room);
      this.addSystemMessage(room, `${existingByToken.name} 重新连回了房间。`);
      return { room, player: existingByToken };
    }

    if (room.phase !== "lobby") {
      throw new GameError("游戏已经开始，只能用原座位重连。");
    }
    if (room.players.length >= room.config.maxPlayers) {
      throw new GameError("房间人数已满。");
    }

    const player: PlayerInternal = {
      id: makeId("p"),
      token: makeId("rt"),
      name: sanitizeName(name),
      seat: this.nextSeat(room),
      ready: false,
      connected: true,
      socketId
    };
    room.players.push(player);
    room.scoreboard[player.id] = room.scoreboard[player.id] ?? 0;
    room.players.sort((a, b) => a.seat - b.seat);
    this.touch(room);
    this.addSystemMessage(room, `${player.name} 加入了房间。`);
    return { room, player };
  }

  getRoom(code: string): RoomInternal {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) {
      throw new GameError("房间不存在或已经过期。");
    }
    return room;
  }

  findRoomByPlayer(playerId: string): RoomInternal | undefined {
    return [...this.rooms.values()].find((room) => room.players.some((player) => player.id === playerId));
  }

  disconnect(socketId: string): RoomInternal | undefined {
    const room = [...this.rooms.values()].find((candidate) =>
      candidate.players.some((player) => player.socketId === socketId)
    );
    if (!room) {
      return undefined;
    }
    const player = room.players.find((candidate) => candidate.socketId === socketId);
    if (!player) {
      return undefined;
    }
    player.connected = false;
    player.socketId = undefined;
    this.touch(room);
    this.addSystemMessage(room, `${player.name} 暂时断开了。`);
    return room;
  }

  setConfig(room: RoomInternal, playerId: string, config: RoomConfig): void {
    this.assertHost(room, playerId);
    this.assertPhase(room, "lobby");
    const error = validateRoleSet(config.maxPlayers, config.roles);
    if (error) {
      throw new GameError(error);
    }
    if (room.players.length > config.maxPlayers) {
      throw new GameError("当前玩家数超过了目标人数。");
    }
    room.config = { maxPlayers: config.maxPlayers, roles: [...config.roles] };
    this.touch(room);
    this.addSystemMessage(room, `房主把本局配置改为 ${config.maxPlayers} 人。`);
  }

  setReady(room: RoomInternal, playerId: string): void {
    this.assertPhase(room, "lobby");
    const player = this.requirePlayer(room, playerId);
    player.ready = !player.ready;
    this.touch(room);
  }

  startGame(room: RoomInternal, playerId: string): void {
    this.assertHost(room, playerId);
    this.assertPhase(room, "lobby");
    const error = validateRoleSet(room.config.maxPlayers, room.config.roles);
    if (error) {
      throw new GameError(error);
    }
    if (room.players.length !== room.config.maxPlayers) {
      throw new GameError(`需要 ${room.config.maxPlayers} 名玩家才能开局。`);
    }
    if (room.players.some((player) => !player.ready && player.id !== room.hostId)) {
      throw new GameError("还有玩家没有准备。");
    }

    const roles = shuffle(room.config.roles);
    room.players.forEach((player, index) => {
      player.roleId = roles[index];
      player.ready = false;
    });
    room.phase = "teamBuild";
    room.leaderSeat = Math.floor(Math.random() * room.players.length);
    room.round = 0;
    room.rejectionCount = 0;
    room.proposedTeam = [];
    room.teamVotes = {};
    room.questSubmissions = {};
    room.questResults = [];
    room.voteHistory = [];
    room.winner = undefined;
    room.winReason = undefined;
    room.assassinId = room.players.find((player) => player.roleId === "Assassin")?.id;
    room.assassinatedPlayerId = undefined;
    this.touch(room);
    this.addSystemMessage(room, "事故演练开始，系统已经私下发放身份。");
  }

  proposeTeam(room: RoomInternal, playerId: string, playerIds: string[]): void {
    this.assertPhase(room, "teamBuild");
    this.assertLeader(room, playerId);
    const expectedSize = getTeamSize(room.players.length, room.round);
    const uniqueIds = [...new Set(playerIds)];
    if (uniqueIds.length !== expectedSize) {
      throw new GameError(`当前任务需要选择 ${expectedSize} 名成员。`);
    }
    for (const proposedId of uniqueIds) {
      this.requirePlayer(room, proposedId);
    }
    room.proposedTeam = uniqueIds;
    room.teamVotes = {};
    room.phase = "teamVote";
    this.touch(room);
    this.addSystemMessage(room, `${this.leader(room).name} 提交了第 ${room.round + 1} 个任务队伍。`);
  }

  castTeamVote(room: RoomInternal, playerId: string, approve: boolean): void {
    this.assertPhase(room, "teamVote");
    this.requirePlayer(room, playerId);
    room.teamVotes[playerId] = approve;
    this.touch(room);

    if (Object.keys(room.teamVotes).length !== room.players.length) {
      return;
    }

    const approveCount = Object.values(room.teamVotes).filter(Boolean).length;
    const approved = approveCount > room.players.length / 2;
    room.voteHistory.push({
      round: room.round,
      attempt: room.rejectionCount + 1,
      leaderId: this.leader(room).id,
      team: [...room.proposedTeam],
      votes: { ...room.teamVotes },
      approved
    });

    if (approved) {
      room.phase = "quest";
      room.questSubmissions = {};
      room.rejectionCount = 0;
      this.addSystemMessage(room, "组队投票通过，任务成员开始秘密提交结果。");
      return;
    }

    room.rejectionCount += 1;
    this.addSystemMessage(room, `组队投票未通过，当前连续拒绝 ${room.rejectionCount}/5。`);
    if (room.rejectionCount >= 5) {
      this.finish(room, "evil", "连续 5 次组队投票失败，项目推进被事故拖垮。");
      return;
    }
    room.phase = "teamBuild";
    room.proposedTeam = [];
    room.teamVotes = {};
    this.advanceLeader(room);
  }

  submitQuestCard(room: RoomInternal, playerId: string, fail: boolean): void {
    this.assertPhase(room, "quest");
    const player = this.requirePlayer(room, playerId);
    if (!room.proposedTeam.includes(playerId)) {
      throw new GameError("只有任务成员可以提交任务牌。");
    }
    if (fail && (!player.roleId || ROLE_INFO[player.roleId].allegiance !== "evil")) {
      throw new GameError("项目组成员只能提交成功。");
    }
    room.questSubmissions[playerId] = fail;
    this.touch(room);

    if (Object.keys(room.questSubmissions).length !== room.proposedTeam.length) {
      return;
    }

    const submissions = room.proposedTeam.map((id) => room.questSubmissions[id] ?? false);
    const result = evaluateQuest(room.players.length, room.round, [...room.proposedTeam], submissions);
    room.questResults.push(result);
    const required = getRequiredFails(room.players.length, room.round);
    this.addSystemMessage(
      room,
      result.passed
        ? `第 ${room.round + 1} 个任务成功，失败牌 ${result.failCount}/${required}。`
        : `第 ${room.round + 1} 个任务失败，失败牌 ${result.failCount}/${required}。`
    );

    const winner = evaluateWinner(room.questResults);
    if (winner === "evil") {
      this.finish(room, "evil", "3 个任务失败，事故阵营获胜。");
      return;
    }
    if (winner === "good") {
      room.phase = "assassination";
      room.proposedTeam = [];
      room.teamVotes = {};
      room.questSubmissions = {};
      this.addSystemMessage(room, "项目组完成了 3 个任务，NPE 开始最后刺杀架构师。");
      return;
    }

    room.round += 1;
    room.phase = "teamBuild";
    room.proposedTeam = [];
    room.teamVotes = {};
    room.questSubmissions = {};
    this.advanceLeader(room);
  }

  assassinate(room: RoomInternal, playerId: string, targetId: string): void {
    this.assertPhase(room, "assassination");
    if (playerId !== room.assassinId) {
      throw new GameError("只有 NPE（刺客）可以执行最后刺杀。");
    }
    const target = this.requirePlayer(room, targetId);
    room.assassinatedPlayerId = target.id;
    if (target.roleId === "Merlin") {
      this.finish(room, "evil", `NPE 成功刺杀架构师 ${target.name}。`, {
        bonusPlayerId: playerId,
        bonusPoints: 1,
        bonusReason: "NPE 刺杀成功"
      });
    } else {
      this.finish(room, "good", `NPE 错认了 ${target.name}，架构师守住了身份。`);
    }
  }

  sendChat(room: RoomInternal, playerId: string, text: string): void {
    const player = this.requirePlayer(room, playerId);
    room.messages.push({
      id: makeId("m"),
      kind: "chat",
      playerId,
      playerName: player.name,
      text,
      createdAt: now()
    });
    room.messages = room.messages.slice(-80);
    this.touch(room);
  }

  restartGame(room: RoomInternal, playerId: string): void {
    this.assertHost(room, playerId);
    room.phase = "lobby";
    room.players.forEach((player) => {
      player.ready = false;
      player.roleId = undefined;
    });
    room.config = {
      maxPlayers: room.players.length >= 5 ? room.players.length : 5,
      roles: getDefaultRoles(Math.max(5, room.players.length))
    };
    room.leaderSeat = 0;
    room.round = 0;
    room.rejectionCount = 0;
    room.proposedTeam = [];
    room.teamVotes = {};
    room.questSubmissions = {};
    room.questResults = [];
    room.voteHistory = [];
    room.winner = undefined;
    room.winReason = undefined;
    room.assassinId = undefined;
    room.assassinatedPlayerId = undefined;
    this.touch(room);
    this.addSystemMessage(room, "房主把房间重置到了准备阶段。");
  }

  endGameEarly(room: RoomInternal, playerId: string): void {
    this.assertHost(room, playerId);
    if (room.phase === "lobby") {
      throw new GameError("游戏还没有开始。");
    }
    if (room.phase === "ended") {
      throw new GameError("本局已经结束。");
    }
    room.phase = "ended";
    room.winner = undefined;
    room.winReason = "房主提前结束了本局，本局不计胜负。";
    room.proposedTeam = [];
    room.teamVotes = {};
    room.questSubmissions = {};
    this.touch(room);
    this.addSystemMessage(room, "房主提前结束了本局，本局不计胜负。");
  }

  publicSnapshot(room: RoomInternal): PublicRoomSnapshot {
    const allVotesSubmitted = Object.keys(room.teamVotes).length === room.players.length;
    return {
      code: room.code,
      config: room.config,
      scoreboard: { ...room.scoreboard },
      players: room.players.map((player) => this.publicPlayer(room, player)),
      phase: room.phase,
      leaderId: room.phase === "lobby" ? undefined : this.leader(room).id,
      round: room.round,
      rejectionCount: room.rejectionCount,
      proposedTeam: [...room.proposedTeam],
      teamVotes: allVotesSubmitted ? { ...room.teamVotes } : undefined,
      teamVoteSubmitted: Object.keys(room.teamVotes),
      questSubmitted: Object.keys(room.questSubmissions),
      questResults: room.questResults,
      voteHistory: room.voteHistory,
      winner: room.winner,
      winReason: room.winReason,
      assassinId: room.assassinId,
      assassinatedPlayerId: room.assassinatedPlayerId,
      messages: room.messages
    };
  }

  privateState(room: RoomInternal, playerId: string): PrivateState {
    const player = this.requirePlayer(room, playerId);
    return computePrivateState(
      playerId,
      room.players.map((candidate) => this.publicPlayer(room, candidate, true)),
      player.token
    );
  }

  private getVisibleRole(room: RoomInternal, player: PlayerInternal): RoleId | undefined {
    if (room.phase === "ended") {
      return player.roleId;
    }
    return undefined;
  }

  private publicPlayer(
    room: RoomInternal,
    player: PlayerInternal,
    includeHiddenRole = false
  ): PlayerPublic & { roleId?: RoleId } {
    return {
      id: player.id,
      name: player.name,
      seat: player.seat,
      ready: player.ready,
      connected: player.connected,
      isHost: player.id === room.hostId,
      roleId: includeHiddenRole ? player.roleId : this.getVisibleRole(room, player)
    };
  }

  private finish(
    room: RoomInternal,
    winner: Winner,
    reason: string,
    bonus?: { bonusPlayerId: string; bonusPoints: number; bonusReason: string }
  ): void {
    room.phase = "ended";
    room.winner = winner;
    room.winReason = reason;
    for (const player of room.players) {
      if (player.roleId && getAllegiance(player.roleId) === winner) {
        room.scoreboard[player.id] = (room.scoreboard[player.id] ?? 0) + 1;
      }
    }
    if (bonus) {
      room.scoreboard[bonus.bonusPlayerId] = (room.scoreboard[bonus.bonusPlayerId] ?? 0) + bonus.bonusPoints;
      this.addSystemMessage(room, `${this.requirePlayer(room, bonus.bonusPlayerId).name} 获得额外 ${bonus.bonusPoints} 分：${bonus.bonusReason}。`);
    }
    room.proposedTeam = [];
    room.teamVotes = {};
    room.questSubmissions = {};
    this.touch(room);
    this.addSystemMessage(room, describeWinner(winner, reason));
  }

  private leader(room: RoomInternal): PlayerInternal {
    return room.players[room.leaderSeat % room.players.length];
  }

  private advanceLeader(room: RoomInternal): void {
    room.leaderSeat = (room.leaderSeat + 1) % room.players.length;
    this.touch(room);
  }

  private assertLeader(room: RoomInternal, playerId: string): void {
    if (this.leader(room).id !== playerId) {
      throw new GameError("当前不是你的队长轮次。");
    }
  }

  private assertHost(room: RoomInternal, playerId: string): void {
    if (room.hostId !== playerId) {
      throw new GameError("只有房主可以执行这个操作。");
    }
  }

  private assertPhase(room: RoomInternal, phase: Phase): void {
    if (room.phase !== phase) {
      throw new GameError("当前阶段不能执行这个操作。");
    }
  }

  private requirePlayer(room: RoomInternal, playerId: string): PlayerInternal {
    const player = room.players.find((candidate) => candidate.id === playerId);
    if (!player) {
      throw new GameError("玩家不存在。");
    }
    return player;
  }

  private nextSeat(room: RoomInternal): number {
    const used = new Set(room.players.map((player) => player.seat));
    for (let seat = 0; seat < room.config.maxPlayers; seat += 1) {
      if (!used.has(seat)) {
        return seat;
      }
    }
    return room.players.length;
  }

  private addSystemMessage(room: RoomInternal, text: string): void {
    room.messages.push({
      id: makeId("m"),
      kind: "system",
      text,
      createdAt: now()
    });
    room.messages = room.messages.slice(-80);
    this.touch(room);
  }

  private touch(room: RoomInternal): void {
    room.updatedAt = now();
  }

  private cleanup(): void {
    const cutoff = now() - ROOM_TTL_MS;
    for (const [code, room] of this.rooms) {
      const empty = room.players.every((player) => !player.connected);
      if (room.updatedAt < cutoff || (empty && room.phase === "ended")) {
        this.rooms.delete(code);
      }
    }
  }
}
