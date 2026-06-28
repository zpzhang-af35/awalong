import type {
  Allegiance,
  PlayerPublic,
  PrivateState,
  QuestResult,
  RoleId,
  RoleInfo,
  RoomConfig,
  Winner
} from "./types";

export const ROLE_INFO: Record<RoleId, RoleInfo> = {
  Merlin: {
    id: "Merlin",
    allegiance: "good",
    displayName: "架构师",
    standardName: "梅林",
    shortDescription: "知道大多数线上事故是谁，但必须藏住自己。",
    canFailQuest: false
  },
  Percival: {
    id: "Percival",
    allegiance: "good",
    displayName: "技术负责人",
    standardName: "派西维尔",
    shortDescription: "能看到架构师候选，但可能被假架构师迷惑。",
    canFailQuest: false
  },
  LoyalServant: {
    id: "LoyalServant",
    allegiance: "good",
    displayName: "程序员",
    standardName: "忠臣",
    shortDescription: "没有额外信息，只能靠讨论和投票守住上线。",
    canFailQuest: false
  },
  Assassin: {
    id: "Assassin",
    allegiance: "evil",
    displayName: "NPE",
    standardName: "刺客",
    shortDescription: "事故阵营核心；最后能刺杀架构师来翻盘。",
    canFailQuest: true
  },
  Morgana: {
    id: "Morgana",
    allegiance: "evil",
    displayName: "假架构师",
    standardName: "莫甘娜",
    shortDescription: "会出现在技术负责人的架构师候选里。",
    canFailQuest: true
  },
  Mordred: {
    id: "Mordred",
    allegiance: "evil",
    displayName: "Race Condition",
    standardName: "莫德雷德",
    shortDescription: "隐藏很深，架构师看不到。",
    canFailQuest: true
  },
  Oberon: {
    id: "Oberon",
    allegiance: "evil",
    displayName: "RuntimeError",
    standardName: "奥伯伦",
    shortDescription: "孤立事故，不认识其他事故，也不被其他事故认识。",
    canFailQuest: true
  },
  Minion: {
    id: "Minion",
    allegiance: "evil",
    displayName: "Bug",
    standardName: "爪牙",
    shortDescription: "普通事故，知道大多数事故同伴。",
    canFailQuest: true
  }
};

export const GOOD_ALIASES = ["程序员", "测试", "产品经理", "项目经理", "运维"];
export const EVIL_ALIASES = ["Bug", "Regression", "Timeout"];

export const TEAM_SIZES: Record<number, number[]> = {
  5: [2, 3, 2, 3, 3],
  6: [2, 3, 4, 3, 4],
  7: [2, 3, 3, 4, 4],
  8: [3, 4, 4, 5, 5],
  9: [3, 4, 4, 5, 5],
  10: [3, 4, 4, 5, 5]
};

export const EVIL_COUNTS: Record<number, number> = {
  5: 2,
  6: 2,
  7: 3,
  8: 3,
  9: 3,
  10: 4
};

const ROLE_PRESETS: Record<number, RoleId[]> = {
  5: ["Merlin", "Percival", "LoyalServant", "Assassin", "Morgana"],
  6: ["Merlin", "Percival", "LoyalServant", "LoyalServant", "Assassin", "Morgana"],
  7: ["Merlin", "Percival", "LoyalServant", "LoyalServant", "Assassin", "Morgana", "Mordred"],
  8: [
    "Merlin",
    "Percival",
    "LoyalServant",
    "LoyalServant",
    "LoyalServant",
    "Assassin",
    "Morgana",
    "Mordred"
  ],
  9: [
    "Merlin",
    "Percival",
    "LoyalServant",
    "LoyalServant",
    "LoyalServant",
    "LoyalServant",
    "Assassin",
    "Morgana",
    "Mordred"
  ],
  10: [
    "Merlin",
    "Percival",
    "LoyalServant",
    "LoyalServant",
    "LoyalServant",
    "LoyalServant",
    "Assassin",
    "Morgana",
    "Mordred",
    "Oberon"
  ]
};

export function getDefaultRoles(playerCount: number): RoleId[] {
  const preset = ROLE_PRESETS[playerCount];
  if (!preset) {
    throw new Error("仅支持 5-10 人局");
  }
  return [...preset];
}

export function getDefaultConfig(playerCount = 5): RoomConfig {
  return {
    maxPlayers: playerCount,
    roles: getDefaultRoles(playerCount)
  };
}

export function getAllegiance(roleId: RoleId): Allegiance {
  return ROLE_INFO[roleId].allegiance;
}

export function validateRoleSet(maxPlayers: number, roles: RoleId[]): string | undefined {
  if (!TEAM_SIZES[maxPlayers]) {
    return "人数必须在 5-10 人之间";
  }
  if (roles.length !== maxPlayers) {
    return "角色数量必须等于房间人数";
  }
  if (!roles.includes("Merlin")) {
    return "必须包含架构师（梅林）";
  }
  if (!roles.includes("Assassin")) {
    return "必须包含 NPE（刺客）";
  }

  const evilCount = roles.filter((roleId) => getAllegiance(roleId) === "evil").length;
  if (evilCount !== EVIL_COUNTS[maxPlayers]) {
    return `${maxPlayers} 人局需要 ${EVIL_COUNTS[maxPlayers]} 名事故阵营`;
  }
  return undefined;
}

export function getTeamSize(playerCount: number, round: number): number {
  return TEAM_SIZES[playerCount]?.[round] ?? 0;
}

export function getRequiredFails(playerCount: number, round: number): number {
  return playerCount >= 7 && round === 3 ? 2 : 1;
}

export function evaluateQuest(
  playerCount: number,
  round: number,
  team: string[],
  submissions: boolean[]
): QuestResult {
  const failCount = submissions.filter(Boolean).length;
  const successCount = submissions.length - failCount;
  const requiredFails = getRequiredFails(playerCount, round);
  return {
    round,
    team,
    failCount,
    successCount,
    requiredFails,
    passed: failCount < requiredFails
  };
}

export function evaluateWinner(results: QuestResult[]): Winner | undefined {
  const goodWins = results.filter((result) => result.passed).length;
  const evilWins = results.filter((result) => !result.passed).length;
  if (goodWins >= 3) {
    return "good";
  }
  if (evilWins >= 3) {
    return "evil";
  }
  return undefined;
}

export function computePrivateState(
  viewerId: string,
  players: Array<PlayerPublic & { roleId?: RoleId }>,
  rejoinToken: string
): PrivateState {
  const viewer = players.find((player) => player.id === viewerId);
  const roleId = viewer?.roleId;
  const knownGoodIds: string[] = [];
  const knownEvilIds: string[] = [];
  const percivalCandidateIds: string[] = [];

  if (roleId === "Merlin") {
    knownEvilIds.push(
      ...players
        .filter(
          (player) =>
            player.id !== viewerId &&
            player.roleId &&
            getAllegiance(player.roleId) === "evil" &&
            player.roleId !== "Mordred"
        )
        .map((player) => player.id)
    );
  }

  if (roleId === "Percival") {
    percivalCandidateIds.push(
      ...players
        .filter((player) => player.roleId === "Merlin" || player.roleId === "Morgana")
        .map((player) => player.id)
    );
  }

  if (roleId && getAllegiance(roleId) === "evil" && roleId !== "Oberon") {
    knownEvilIds.push(
      ...players
        .filter(
          (player) =>
            player.id !== viewerId &&
            player.roleId &&
            getAllegiance(player.roleId) === "evil" &&
            player.roleId !== "Oberon"
        )
        .map((player) => player.id)
    );
  }

  return {
    playerId: viewerId,
    roleId,
    roleInfo: roleId ? ROLE_INFO[roleId] : undefined,
    knownGoodIds,
    knownEvilIds,
    percivalCandidateIds,
    rejoinToken
  };
}

export function getRoleLabel(roleId: RoleId, index = 0): string {
  if (roleId === "LoyalServant") {
    return GOOD_ALIASES[index % GOOD_ALIASES.length];
  }
  if (roleId === "Minion") {
    return EVIL_ALIASES[index % EVIL_ALIASES.length];
  }
  return ROLE_INFO[roleId].displayName;
}

export function describeWinner(winner: Winner, reason: string): string {
  const side = winner === "good" ? "项目组" : "事故阵营";
  return `${side}获胜：${reason}`;
}
