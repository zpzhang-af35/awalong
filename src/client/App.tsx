import {
  Check,
  CircleStop,
  Clipboard,
  Eye,
  EyeOff,
  LogIn,
  MessageCircle,
  Play,
  RefreshCw,
  Send,
  Shield,
  Swords,
  ThumbsDown,
  ThumbsUp,
  Users
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import {
  getDefaultRoles,
  getRequiredFails,
  getRoleLabel,
  getTeamSize,
  ROLE_INFO,
  validateRoleSet
} from "../shared/rules";
import { ROLE_IDS, type PrivateState, type PublicRoomSnapshot, type RoleId } from "../shared/types";

interface StoredSession {
  roomCode: string;
  playerId: string;
  rejoinToken: string;
  name: string;
}

type Ack = { ok: true; roomCode: string; playerId: string; rejoinToken: string } | { ok: false; error: string };

const SESSION_KEY = "it-avalon-session";
const TEST_MODE_KEY = "it-avalon-local-test-mode";
const TAB_ID_KEY = "it-avalon-tab-id";
const phaseLabel: Record<PublicRoomSnapshot["phase"], string> = {
  lobby: "准备",
  teamBuild: "组队",
  teamVote: "投票",
  quest: "任务",
  assassination: "刺杀",
  ended: "结算"
};

function isLocalhost(): boolean {
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function ensureTabId(): string {
  let tabId = sessionStorage.getItem(TAB_ID_KEY);
  if (!tabId) {
    tabId = crypto.randomUUID();
    sessionStorage.setItem(TAB_ID_KEY, tabId);
  }
  return tabId;
}

function testSessionKey(): string {
  return `${SESSION_KEY}:${ensureTabId()}`;
}

function isTestModeEnabled(): boolean {
  return isLocalhost() && localStorage.getItem(TEST_MODE_KEY) === "true";
}

function setTestModeEnabled(enabled: boolean): void {
  if (enabled) {
    localStorage.setItem(TEST_MODE_KEY, "true");
  } else {
    localStorage.removeItem(TEST_MODE_KEY);
  }
}

function getSessionStorage(): Storage {
  return isTestModeEnabled() ? sessionStorage : localStorage;
}

function getSessionKey(): string {
  return isTestModeEnabled() ? testSessionKey() : SESSION_KEY;
}

function loadSession(): StoredSession | undefined {
  try {
    const raw = getSessionStorage().getItem(getSessionKey());
    return raw ? (JSON.parse(raw) as StoredSession) : undefined;
  } catch {
    return undefined;
  }
}

function saveSession(session: StoredSession): void {
  getSessionStorage().setItem(getSessionKey(), JSON.stringify(session));
}

function clearCurrentSession(): void {
  getSessionStorage().removeItem(getSessionKey());
}

function playerName(snapshot: PublicRoomSnapshot, id: string): string {
  return snapshot.players.find((player) => player.id === id)?.name ?? "未知玩家";
}

export function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [snapshot, setSnapshot] = useState<PublicRoomSnapshot | null>(null);
  const [privateState, setPrivateState] = useState<PrivateState | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState(loadSession()?.name ?? "");
  const [roomCode, setRoomCode] = useState(new URLSearchParams(window.location.search).get("room") ?? "");
  const [localTestMode, setLocalTestMode] = useState(isTestModeEnabled());
  const [selectedTeam, setSelectedTeam] = useState<string[]>([]);
  const [identityVisible, setIdentityVisible] = useState(false);
  const [chatText, setChatText] = useState("");
  const [copied, setCopied] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const nextSocket = io({ path: "/socket.io" });
    nextSocket.on("roomSnapshot", (nextSnapshot: PublicRoomSnapshot) => {
      setSnapshot(nextSnapshot);
      setSelectedTeam((current) => current.filter((id) => nextSnapshot.players.some((player) => player.id === id)));
    });
    nextSocket.on("privateState", (state: PrivateState) => {
      setPrivateState(state);
    });
    nextSocket.on("gameError", (message: string) => {
      setError(message);
    });
    setSocket(nextSocket);

    const session = loadSession();
    const urlRoom = new URLSearchParams(window.location.search).get("room");
    if (session && (urlRoom ? session.roomCode === urlRoom.toUpperCase() : true)) {
      nextSocket.emit(
        "joinRoom",
        { code: session.roomCode, name: session.name, rejoinToken: session.rejoinToken },
        (ack: Ack) => {
          if (ack.ok) {
            saveSession({ roomCode: ack.roomCode, playerId: ack.playerId, rejoinToken: ack.rejoinToken, name: session.name });
          }
        }
      );
    }

    return () => {
      nextSocket.disconnect();
    };
  }, [localTestMode]);

  useEffect(() => {
    if (!identityVisible) {
      return;
    }
    const timeout = window.setTimeout(() => setIdentityVisible(false), 9000);
    return () => window.clearTimeout(timeout);
  }, [identityVisible, privateState?.roleId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [snapshot?.messages.length]);

  const me = useMemo(
    () => snapshot?.players.find((player) => player.id === privateState?.playerId),
    [privateState?.playerId, snapshot?.players]
  );
  const leader = snapshot?.leaderId ? snapshot.players.find((player) => player.id === snapshot.leaderId) : undefined;
  const isHost = Boolean(me?.isHost);
  const isLeader = Boolean(me && snapshot?.leaderId === me.id);
  const requiredTeamSize = snapshot ? getTeamSize(snapshot.players.length, snapshot.round) : 0;
  const myVoteSubmitted = Boolean(me && snapshot?.teamVoteSubmitted.includes(me.id));
  const myQuestSubmitted = Boolean(me && snapshot?.questSubmitted.includes(me.id));
  const onQuestTeam = Boolean(me && snapshot?.proposedTeam.includes(me.id));
  const isAssassin = Boolean(me && snapshot?.assassinId === me.id);

  function emit(event: string, payload?: unknown): void {
    setError("");
    socket?.emit(event, payload);
  }

  function handleCreateRoom() {
    if (!socket || !name.trim()) {
      setError("先给自己起一个昵称。");
      return;
    }
    socket.emit("createRoom", { name }, (ack: Ack) => {
      if (!ack.ok) {
        setError(ack.error);
        return;
      }
      saveSession({ roomCode: ack.roomCode, playerId: ack.playerId, rejoinToken: ack.rejoinToken, name });
      window.history.replaceState(null, "", `?room=${ack.roomCode}`);
    });
  }

  function handleToggleLocalTestMode(enabled: boolean) {
    setTestModeEnabled(enabled);
    clearCurrentSession();
    setLocalTestMode(enabled);
    setSnapshot(null);
    setPrivateState(null);
    setError("");
    window.history.replaceState(null, "", window.location.pathname);
    setRoomCode("");
  }

  function handleJoinRoom() {
    if (!socket || !name.trim() || !roomCode.trim()) {
      setError("昵称和房间码都要填。");
      return;
    }
    const session = loadSession();
    socket.emit(
      "joinRoom",
      {
        code: roomCode.toUpperCase(),
        name,
        rejoinToken: session?.roomCode === roomCode.toUpperCase() ? session.rejoinToken : undefined
      },
      (ack: Ack) => {
        if (!ack.ok) {
          setError(ack.error);
          return;
        }
        saveSession({ roomCode: ack.roomCode, playerId: ack.playerId, rejoinToken: ack.rejoinToken, name });
        window.history.replaceState(null, "", `?room=${ack.roomCode}`);
      }
    );
  }

  function handleConfigPlayers(maxPlayers: number) {
    emit("setConfig", { maxPlayers, roles: getDefaultRoles(maxPlayers) });
  }

  function handleRoleChange(index: number, roleId: RoleId) {
    if (!snapshot) {
      return;
    }
    const roles = [...snapshot.config.roles];
    roles[index] = roleId;
    const validation = validateRoleSet(snapshot.config.maxPlayers, roles);
    if (validation) {
      setError(validation);
      return;
    }
    emit("setConfig", { maxPlayers: snapshot.config.maxPlayers, roles });
  }

  function toggleSelected(playerId: string) {
    if (!isLeader || snapshot?.phase !== "teamBuild") {
      return;
    }
    setSelectedTeam((current) => {
      if (current.includes(playerId)) {
        return current.filter((id) => id !== playerId);
      }
      if (current.length >= requiredTeamSize) {
        return current;
      }
      return [...current, playerId];
    });
  }

  function copyInvite() {
    if (!snapshot) {
      return;
    }
    const url = `${window.location.origin}${window.location.pathname}?room=${snapshot.code}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  }

  function submitChat() {
    if (!chatText.trim()) {
      return;
    }
    emit("sendChat", { text: chatText.trim() });
    setChatText("");
  }

  if (!snapshot) {
    return (
      <main className="entry-shell">
        <section className="entry-panel">
          <div className="brand-row">
            <Swords aria-hidden="true" />
            <div>
              <h1>评审风云</h1>
              <p>开房、发身份、投票和事故演练都在这里。</p>
            </div>
          </div>
          <label>
            昵称
            <input value={name} maxLength={18} onChange={(event) => setName(event.target.value)} placeholder="比如：小张" />
          </label>
          {isLocalhost() && (
            <label className="toggle-line">
              <input
                type="checkbox"
                checked={localTestMode}
                onChange={(event) => handleToggleLocalTestMode(event.target.checked)}
              />
              本机多开测试
            </label>
          )}
          {isLocalhost() && localTestMode && (
            <p className="test-mode-note">已开启：每个浏览器 tab 会保存成独立玩家，适合 localhost 单机跑完整局。</p>
          )}
          <div className="entry-actions">
            <button className="primary" onClick={handleCreateRoom}>
              <Play size={18} />
              创建房间
            </button>
          </div>
          <div className="join-row">
            <label>
              房间码
              <input
                value={roomCode}
                maxLength={6}
                onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
                placeholder="6位代码"
              />
            </label>
            <button onClick={handleJoinRoom}>
              <LogIn size={18} />
              加入
            </button>
          </div>
          {error && <p className="error-text">{error}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">房间 {snapshot.code}</div>
          <h1>评审风云</h1>
        </div>
        <div className="topbar-actions">
          <span className={`phase-badge phase-${snapshot.phase}`}>{phaseLabel[snapshot.phase]}</span>
          <button className="icon-button" title="复制邀请链接" onClick={copyInvite}>
            {copied ? <Check size={18} /> : <Clipboard size={18} />}
          </button>
        </div>
      </header>

      {error && (
        <div className="toast" role="alert">
          {error}
        </div>
      )}

      <section className="main-grid">
        <aside className="left-rail">
          <IdentityCard
            privateState={privateState}
            snapshot={snapshot}
            visible={identityVisible}
            onToggle={() => setIdentityVisible((value) => !value)}
          />
          <ScoreboardPanel snapshot={snapshot} />
          <QuestBoard snapshot={snapshot} />
          <PlayerList
            snapshot={snapshot}
            selectedTeam={selectedTeam}
            onToggleSelected={toggleSelected}
            privateState={privateState}
          />
        </aside>

        <section className="workbench">
          <ActionPanel
            snapshot={snapshot}
            meId={me?.id}
            isHost={isHost}
            isLeader={isLeader}
            isAssassin={isAssassin}
            onQuestTeam={onQuestTeam}
            myVoteSubmitted={myVoteSubmitted}
            myQuestSubmitted={myQuestSubmitted}
            selectedTeam={selectedTeam}
            requiredTeamSize={requiredTeamSize}
            leaderName={leader?.name}
            onSetPlayers={handleConfigPlayers}
            onRoleChange={handleRoleChange}
            onReady={() => emit("setReady")}
            onStart={() => emit("startGame")}
            onPropose={() => emit("proposeTeam", { playerIds: selectedTeam })}
            onVote={(approve) => emit("castTeamVote", { approve })}
            onQuest={(fail) => emit("submitQuestCard", { fail })}
            onAssassinate={(playerId) => emit("assassinate", { playerId })}
            onEndGame={() => emit("endGameEarly")}
            onRestart={() => emit("restartGame")}
          />
        </section>

        <aside className="right-rail">
          <LogPanel snapshot={snapshot} chatText={chatText} setChatText={setChatText} onSubmit={submitChat} endRef={chatEndRef} />
        </aside>
      </section>
    </main>
  );
}

function IdentityCard({
  privateState,
  snapshot,
  visible,
  onToggle
}: {
  privateState: PrivateState | null;
  snapshot: PublicRoomSnapshot;
  visible: boolean;
  onToggle: () => void;
}) {
  const role = privateState?.roleInfo;
  const showDetails = visible && role;
  const knownEvil = privateState?.knownEvilIds.map((id) => playerName(snapshot, id)) ?? [];
  const candidates = privateState?.percivalCandidateIds.map((id) => playerName(snapshot, id)) ?? [];

  return (
    <section className={`identity-panel ${showDetails ? "revealed" : ""}`}>
      <div className="section-heading">
        <div>
          <span className="eyebrow">我的身份</span>
          <h2>{showDetails ? role.displayName : "已遮挡"}</h2>
        </div>
        <button className="icon-button" title={showDetails ? "隐藏身份" : "查看身份"} onClick={onToggle}>
          {showDetails ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      {showDetails ? (
        <>
          <p className="role-standard">{role.standardName} · {role.allegiance === "good" ? "项目组" : "事故阵营"}</p>
          <p>{role.shortDescription}</p>
          {knownEvil.length > 0 && <p className="intel">已知事故：{knownEvil.join("、")}</p>}
          {candidates.length > 0 && <p className="intel">架构师候选：{candidates.join("、")}</p>}
        </>
      ) : (
        <p>点击眼睛短暂查看。投屏或同屏时，它会自动盖回去。</p>
      )}
    </section>
  );
}

function ScoreboardPanel({ snapshot }: { snapshot: PublicRoomSnapshot }) {
  const ranking = [...snapshot.players].sort((left, right) => {
    const scoreDiff = (snapshot.scoreboard[right.id] ?? 0) - (snapshot.scoreboard[left.id] ?? 0);
    return scoreDiff || left.seat - right.seat;
  });

  return (
    <section className="panel scoreboard-panel">
      <div className="section-heading compact">
        <h2>记分牌</h2>
        <span>个人分</span>
      </div>
      <div className="score-list">
        {ranking.map((player, index) => (
          <div key={player.id} className="score-row">
            <span className="rank">{index + 1}</span>
            <strong>{player.name}</strong>
            <span>{snapshot.scoreboard[player.id] ?? 0}</span>
          </div>
        ))}
      </div>
      <p>胜利阵营每人 +1，NPE 刺杀成功额外 +1，提前结束不计分。</p>
    </section>
  );
}

function QuestBoard({ snapshot }: { snapshot: PublicRoomSnapshot }) {
  return (
    <section className="panel">
      <div className="section-heading compact">
        <h2>任务进度</h2>
        <span>{snapshot.questResults.filter((result) => result.passed).length} / 3</span>
      </div>
      <div className="quest-row">
        {[0, 1, 2, 3, 4].map((round) => {
          const result = snapshot.questResults.find((item) => item.round === round);
          const active = snapshot.round === round && snapshot.phase !== "ended";
          return (
            <div key={round} className={`quest-node ${result?.passed ? "passed" : ""} ${result && !result.passed ? "failed" : ""} ${active ? "active" : ""}`}>
              <strong>{round + 1}</strong>
              <span>{getTeamSize(snapshot.config.maxPlayers, round)}人</span>
              <small>{getRequiredFails(snapshot.config.maxPlayers, round)}败</small>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PlayerList({
  snapshot,
  selectedTeam,
  onToggleSelected,
  privateState
}: {
  snapshot: PublicRoomSnapshot;
  selectedTeam: string[];
  onToggleSelected: (playerId: string) => void;
  privateState: PrivateState | null;
}) {
  return (
    <section className="panel">
      <div className="section-heading compact">
        <h2>玩家</h2>
        <span>{snapshot.players.length}/{snapshot.config.maxPlayers}</span>
      </div>
      <div className="player-list">
        {snapshot.players.map((player) => {
          const selected = selectedTeam.includes(player.id) || snapshot.proposedTeam.includes(player.id);
          const role = player.roleId ? ROLE_INFO[player.roleId] : undefined;
          return (
            <button
              key={player.id}
              className={`player-row ${selected ? "selected" : ""} ${!player.connected ? "offline" : ""}`}
              onClick={() => onToggleSelected(player.id)}
            >
              <span className="seat">{player.seat + 1}</span>
              <span className="player-main">
                <strong>{player.name}</strong>
                <small>
                  {player.isHost ? "房主 · " : ""}
                  {snapshot.leaderId === player.id ? "队长 · " : ""}
                  {player.ready ? "已准备" : snapshot.phase === "lobby" ? "未准备" : "在线"}
                </small>
              </span>
              {privateState?.knownEvilIds.includes(player.id) && <span className="tag danger">事故</span>}
              {privateState?.percivalCandidateIds.includes(player.id) && <span className="tag info">候选</span>}
              {role && <span className="tag">{role.displayName}</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ActionPanel(props: {
  snapshot: PublicRoomSnapshot;
  meId?: string;
  isHost: boolean;
  isLeader: boolean;
  isAssassin: boolean;
  onQuestTeam: boolean;
  myVoteSubmitted: boolean;
  myQuestSubmitted: boolean;
  selectedTeam: string[];
  requiredTeamSize: number;
  leaderName?: string;
  onSetPlayers: (count: number) => void;
  onRoleChange: (index: number, roleId: RoleId) => void;
  onReady: () => void;
  onStart: () => void;
  onPropose: () => void;
  onVote: (approve: boolean) => void;
  onQuest: (fail: boolean) => void;
  onAssassinate: (playerId: string) => void;
  onEndGame: () => void;
  onRestart: () => void;
}) {
  const { snapshot } = props;
  const me = snapshot.players.find((player) => player.id === props.meId);

  if (snapshot.phase === "lobby") {
    return (
      <section className="action-panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">准备阶段</span>
            <h2>组一支上线小队</h2>
          </div>
          <Users aria-hidden="true" />
        </div>
        <div className="config-grid">
          <label>
            人数
            <select
              disabled={!props.isHost}
              value={snapshot.config.maxPlayers}
              onChange={(event) => props.onSetPlayers(Number(event.target.value))}
            >
              {[5, 6, 7, 8, 9, 10].map((count) => (
                <option key={count} value={count}>
                  {count} 人
                </option>
              ))}
            </select>
          </label>
          <div className="hint-box">
            {props.isHost ? "房主可以调整推荐角色。人数改变会自动套用推荐配置。" : "等待房主确认人数和角色。"}
          </div>
        </div>
        <div className="role-config">
          {snapshot.config.roles.map((roleId, index) => (
            <label key={`${index}-${roleId}`}>
              槽位 {index + 1}
              <select
                disabled={!props.isHost}
                value={roleId}
                onChange={(event) => props.onRoleChange(index, event.target.value as RoleId)}
              >
                {ROLE_IDS.map((id) => (
                  <option key={id} value={id}>
                    {getRoleLabel(id, index)} / {ROLE_INFO[id].standardName}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <div className="action-row">
          <button onClick={props.onReady} className={me?.ready ? "success" : ""}>
            <Check size={18} />
            {me?.ready ? "取消准备" : "准备"}
          </button>
          {props.isHost && (
            <button className="primary" onClick={props.onStart}>
              <Play size={18} />
              开始
            </button>
          )}
        </div>
      </section>
    );
  }

  if (snapshot.phase === "teamBuild") {
    return (
      <section className="action-panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">第 {snapshot.round + 1} 个任务</span>
            <h2>{props.isLeader ? "选择任务成员" : `等待 ${props.leaderName ?? "队长"} 组织发起项目评审`}</h2>
          </div>
          <Shield aria-hidden="true" />
        </div>
        <p>本轮需要 {props.requiredTeamSize} 人。点击左侧玩家加入或移出队伍。</p>
        <div className="selected-team">
          {props.selectedTeam.length === 0 ? "还没有选择成员" : props.selectedTeam.map((id) => playerName(snapshot, id)).join("、")}
        </div>
        {props.isLeader && (
          <div className="action-row split-row">
            <button className="primary" disabled={props.selectedTeam.length !== props.requiredTeamSize} onClick={props.onPropose}>
              <Send size={18} />
              提交队伍
            </button>
            {props.isHost && (
              <button className="danger-outline" onClick={props.onEndGame}>
                <CircleStop size={18} />
                提前结束
              </button>
            )}
          </div>
        )}
        {!props.isLeader && props.isHost && (
          <button className="danger-outline" onClick={props.onEndGame}>
            <CircleStop size={18} />
            提前结束
          </button>
        )}
      </section>
    );
  }

  if (snapshot.phase === "teamVote") {
    return (
      <section className="action-panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">组队投票</span>
            <h2>是否让这支队伍上线？</h2>
          </div>
          <MessageCircle aria-hidden="true" />
        </div>
        <p>队伍：{snapshot.proposedTeam.map((id) => playerName(snapshot, id)).join("、")}</p>
        <p>已投票：{snapshot.teamVoteSubmitted.length}/{snapshot.players.length}，连续拒绝 {snapshot.rejectionCount}/5。</p>
        <div className="action-row">
          <button disabled={props.myVoteSubmitted} onClick={() => props.onVote(false)}>
            <ThumbsDown size={18} />
            反对
          </button>
          <button className="primary" disabled={props.myVoteSubmitted} onClick={() => props.onVote(true)}>
            <ThumbsUp size={18} />
            赞成
          </button>
        </div>
        {props.isHost && (
          <button className="danger-outline" onClick={props.onEndGame}>
            <CircleStop size={18} />
            提前结束
          </button>
        )}
      </section>
    );
  }

  if (snapshot.phase === "quest") {
    return (
      <section className="action-panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">秘密任务</span>
            <h2>{props.onQuestTeam ? "提交任务牌" : "等待任务成员提交"}</h2>
          </div>
          <Swords aria-hidden="true" />
        </div>
        <p>任务成员：{snapshot.proposedTeam.map((id) => playerName(snapshot, id)).join("、")}</p>
        <p>已提交：{snapshot.questSubmitted.length}/{snapshot.proposedTeam.length}</p>
        {props.onQuestTeam && (
          <div className="action-row">
            <button className="primary" disabled={props.myQuestSubmitted} onClick={() => props.onQuest(false)}>
              <Check size={18} />
              成功
            </button>
            <button className="danger-button" disabled={props.myQuestSubmitted} onClick={() => props.onQuest(true)}>
              <Swords size={18} />
              破坏
            </button>
          </div>
        )}
        {props.isHost && (
          <button className="danger-outline" onClick={props.onEndGame}>
            <CircleStop size={18} />
            提前结束
          </button>
        )}
      </section>
    );
  }

  if (snapshot.phase === "assassination") {
    return (
      <section className="action-panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">最后刺杀</span>
            <h2>{props.isAssassin ? "选择架构师" : "等待 NPE 刺杀"}</h2>
          </div>
          <Swords aria-hidden="true" />
        </div>
        <div className="assassin-grid">
          {snapshot.players.map((player) => (
            <button key={player.id} disabled={!props.isAssassin} onClick={() => props.onAssassinate(player.id)}>
              {player.name}
            </button>
          ))}
        </div>
        {props.isHost && (
          <button className="danger-outline" onClick={props.onEndGame}>
            <CircleStop size={18} />
            提前结束
          </button>
        )}
      </section>
    );
  }

  const endedTitle =
    snapshot.winner === "good" ? "项目组获胜" : snapshot.winner === "evil" ? "事故阵营获胜" : "本局已提前结束";

  return (
    <section className="action-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">结算</span>
          <h2>{endedTitle}</h2>
        </div>
        <Shield aria-hidden="true" />
      </div>
      <p>{snapshot.winReason}</p>
      <div className="reveal-grid">
        {snapshot.players.map((player, index) => (
          <div key={player.id} className="reveal-item">
            <strong>{player.name}</strong>
            <span>{player.roleId ? getRoleLabel(player.roleId, index) : "未知"}</span>
          </div>
        ))}
      </div>
      {props.isHost && (
        <button className="primary" onClick={props.onRestart}>
          <RefreshCw size={18} />
          同房再来
        </button>
      )}
    </section>
  );
}

function LogPanel({
  snapshot,
  chatText,
  setChatText,
  onSubmit,
  endRef
}: {
  snapshot: PublicRoomSnapshot;
  chatText: string;
  setChatText: (value: string) => void;
  onSubmit: () => void;
  endRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <section className="panel log-panel">
      <div className="section-heading compact">
        <h2>聊天与日志</h2>
        <span>{snapshot.messages.length}</span>
      </div>
      <div className="messages">
        {snapshot.messages.map((message) => (
          <div key={message.id} className={`message ${message.kind}`}>
            {message.kind === "chat" && <strong>{message.playerName}</strong>}
            <span>{message.text}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="chat-input">
        <input
          value={chatText}
          maxLength={400}
          onChange={(event) => setChatText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              onSubmit();
            }
          }}
          placeholder="讨论一下谁像事故源"
        />
        <button className="icon-button" title="发送" onClick={onSubmit}>
          <Send size={18} />
        </button>
      </div>
    </section>
  );
}
