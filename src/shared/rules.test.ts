import { describe, expect, it } from "vitest";
import {
  computePrivateState,
  evaluateQuest,
  evaluateWinner,
  getDefaultRoles,
  getRequiredFails,
  getTeamSize,
  validateRoleSet
} from "./rules";
import type { PlayerPublic, RoleId } from "./types";

function player(id: string, roleId: RoleId): PlayerPublic & { roleId: RoleId } {
  return {
    id,
    name: id,
    seat: Number(id.slice(1)) || 0,
    ready: true,
    connected: true,
    isHost: false,
    roleId
  };
}

describe("Avalon rules", () => {
  it("uses the standard team sizes", () => {
    expect([0, 1, 2, 3, 4].map((round) => getTeamSize(5, round))).toEqual([2, 3, 2, 3, 3]);
    expect([0, 1, 2, 3, 4].map((round) => getTeamSize(7, round))).toEqual([2, 3, 3, 4, 4]);
    expect([0, 1, 2, 3, 4].map((round) => getTeamSize(10, round))).toEqual([3, 4, 4, 5, 5]);
  });

  it("requires two fails on the fourth quest for 7+ players only", () => {
    expect(getRequiredFails(6, 3)).toBe(1);
    expect(getRequiredFails(7, 3)).toBe(2);
    expect(evaluateQuest(7, 3, ["a", "b", "c", "d"], [true, false, false, false]).passed).toBe(true);
    expect(evaluateQuest(7, 3, ["a", "b", "c", "d"], [true, true, false, false]).passed).toBe(false);
  });

  it("validates default role presets", () => {
    for (const playerCount of [5, 6, 7, 8, 9, 10]) {
      expect(validateRoleSet(playerCount, getDefaultRoles(playerCount))).toBeUndefined();
    }
  });

  it("ends after three successful or failed quests", () => {
    const pass = evaluateQuest(5, 0, ["a", "b"], [false, false]);
    const fail = evaluateQuest(5, 1, ["a", "b", "c"], [true, false, false]);
    expect(evaluateWinner([pass, pass, pass])).toBe("good");
    expect(evaluateWinner([fail, fail, fail])).toBe("evil");
  });
});

describe("private role information", () => {
  const players = [
    player("p1", "Merlin"),
    player("p2", "Percival"),
    player("p3", "LoyalServant"),
    player("p4", "Assassin"),
    player("p5", "Morgana"),
    player("p6", "Mordred"),
    player("p7", "Oberon")
  ];

  it("lets Merlin see evil players except Mordred", () => {
    const state = computePrivateState("p1", players, "token");
    expect(state.knownEvilIds.sort()).toEqual(["p4", "p5", "p7"]);
  });

  it("lets Percival see Merlin and Morgana candidates", () => {
    const state = computePrivateState("p2", players, "token");
    expect(state.percivalCandidateIds.sort()).toEqual(["p1", "p5"]);
  });

  it("keeps Oberon out of evil mutual recognition", () => {
    const assassinState = computePrivateState("p4", players, "token");
    const oberonState = computePrivateState("p7", players, "token");
    expect(assassinState.knownEvilIds.sort()).toEqual(["p5", "p6"]);
    expect(oberonState.knownEvilIds).toEqual([]);
  });
});
