import { describe, expect, it } from "vitest";
import { getAllegiance, getDefaultRoles } from "../shared/rules";
import { RoomStore } from "./roomStore";

function fillFivePlayerRoom(store: RoomStore) {
  const created = store.createRoom("host", "s0");
  for (let index = 1; index < 5; index += 1) {
    store.joinRoom(created.room.code, `p${index}`, `s${index}`);
  }
  for (const player of created.room.players) {
    if (player.id !== created.room.hostId) {
      store.setReady(created.room, player.id);
    }
  }
  store.startGame(created.room, created.room.hostId);
  return created.room;
}

describe("RoomStore game flow", () => {
  it("lets a player rejoin the same seat with a rejoin token", () => {
    const store = new RoomStore();
    const { room, player } = store.createRoom("host", "socket-a");

    store.disconnect("socket-a");
    const rejoined = store.joinRoom(room.code, "host-renamed", "socket-b", player.token);

    expect(rejoined.player.id).toBe(player.id);
    expect(rejoined.player.seat).toBe(0);
    expect(rejoined.player.connected).toBe(true);
    expect(rejoined.player.socketId).toBe("socket-b");
  });

  it("gives evil the win after five rejected teams", () => {
    const store = new RoomStore();
    const room = fillFivePlayerRoom(store);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const snapshot = store.publicSnapshot(room);
      const leaderId = snapshot.leaderId!;
      const team = snapshot.players.slice(0, 2).map((player) => player.id);
      store.proposeTeam(room, leaderId, team);
      for (const player of room.players) {
        store.castTeamVote(room, player.id, false);
      }
    }

    expect(room.phase).toBe("ended");
    expect(room.winner).toBe("evil");
    for (const player of room.players) {
      expect(room.scoreboard[player.id]).toBe(getAllegiance(player.roleId!) === "evil" ? 1 : 0);
    }
  });

  it("resolves assassination after three successful quests", () => {
    const store = new RoomStore();
    const room = fillFivePlayerRoom(store);
    const roles = getDefaultRoles(5);
    room.players.forEach((player, index) => {
      player.roleId = roles[index];
    });
    room.assassinId = room.players.find((player) => player.roleId === "Assassin")!.id;

    for (let round = 0; round < 3; round += 1) {
      const snapshot = store.publicSnapshot(room);
      const teamSize = round === 1 ? 3 : 2;
      const team = snapshot.players.slice(0, teamSize).map((player) => player.id);
      store.proposeTeam(room, snapshot.leaderId!, team);
      for (const player of room.players) {
        store.castTeamVote(room, player.id, true);
      }
      for (const playerId of team) {
        store.submitQuestCard(room, playerId, false);
      }
    }

    expect(room.phase).toBe("assassination");

    const merlinId = room.players.find((player) => player.roleId === "Merlin")!.id;
    store.assassinate(room, room.assassinId!, merlinId);
    expect(room.phase).toBe("ended");
    expect(room.winner).toBe("evil");
    for (const player of room.players) {
      const expectedScore = player.id === room.assassinId ? 2 : getAllegiance(player.roleId!) === "evil" ? 1 : 0;
      expect(room.scoreboard[player.id]).toBe(expectedScore);
    }
  });

  it("lets only the host end an active game early", () => {
    const store = new RoomStore();
    const room = fillFivePlayerRoom(store);
    const nonHost = room.players.find((player) => player.id !== room.hostId)!;

    expect(() => store.endGameEarly(room, nonHost.id)).toThrow("只有房主可以执行这个操作。");

    store.endGameEarly(room, room.hostId);
    const snapshot = store.publicSnapshot(room);

    expect(snapshot.phase).toBe("ended");
    expect(snapshot.winner).toBeUndefined();
    expect(snapshot.winReason).toContain("不计胜负");
    expect(snapshot.players.every((player) => player.roleId)).toBe(true);
    expect(Object.values(snapshot.scoreboard).every((score) => score === 0)).toBe(true);
  });

  it("keeps accumulated scores when the host restarts in the same room", () => {
    const store = new RoomStore();
    const room = fillFivePlayerRoom(store);
    const [firstPlayer, secondPlayer] = room.players;

    room.scoreboard[firstPlayer.id] = 2;
    room.scoreboard[secondPlayer.id] = 1;
    store.restartGame(room, room.hostId);

    expect(store.publicSnapshot(room).scoreboard[firstPlayer.id]).toBe(2);
    expect(store.publicSnapshot(room).scoreboard[secondPlayer.id]).toBe(1);
  });
});
