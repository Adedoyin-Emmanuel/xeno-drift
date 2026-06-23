import { useCallback, useEffect, useRef, useState } from "react";
import { GameCanvas } from "./components/GameCanvas";
import { HUD } from "./components/HUD";
import {
  SignInScreen,
  StartScreen,
  PauseScreen,
  GameOverScreen,
} from "./components/Overlays";
import {
  MultiplayerChoice,
  HostLobby,
  GuestLobby,
} from "./components/MultiplayerLobby";
import type { GameEngine, PublicState } from "./game/engine";
import {
  clearStoredPlayer,
  loadStoredPlayer,
  signInOrCreate,
  submitGameResult,
  type StoredPlayer,
} from "./lib/player";
import { supabase, type Player } from "./lib/supabase";
import {
  createHostRoom,
  joinGuestRoom,
  submitCoopResult,
  type CoopSnapshot,
  type HostHandle,
  type GuestHandle,
} from "./lib/realtime";

type GameResult = { score: number; wave: number; kills: number };
type Screen =
  | "playing"          // engine drives UI (menu/playing/paused/over)
  | "mp-choice"        // multiplayer modal
  | "mp-host-lobby"    // host waiting / countdown
  | "mp-guest-lobby";  // guest entering code / waiting / countdown

const INITIAL_STATE: PublicState = {
  state: "menu",
  score: 0,
  wave: 1,
  kills: 0,
  hp: 100,
  maxHp: 100,
  dashCd: 0,
  dashMax: 1.4,
  combo: 1,
  buffs: { shield: 0, rapid: 0, spread: 0 },
  boss: null,
  muted: false,
};

export default function App() {
  const engineRef = useRef<GameEngine | null>(null);
  const [gameState, setGameState] = useState<PublicState>(INITIAL_STATE);
  const [player, setPlayer] = useState<(StoredPlayer & Partial<Player>) | null>(null);
  const [hydrating, setHydrating] = useState(true);
  const [result, setResult] = useState<GameResult | null>(null);
  const [savingResult, setSavingResult] = useState(false);
  const [isNewBest, setIsNewBest] = useState(false);

  // Multiplayer state
  const [screen, setScreen] = useState<Screen>("playing");
  const [mode, setMode] = useState<"solo" | "host" | "guest">("solo");
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [hostName, setHostName] = useState<string | null>(null);
  const [guestName, setGuestName] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [guestStatus, setGuestStatus] = useState<"input" | "connecting" | "waiting">("input");
  const hostHandleRef = useRef<HostHandle | null>(null);
  const guestHandleRef = useRef<GuestHandle | null>(null);
  const inputPumpRef = useRef<number | null>(null);
  // Stable refs for values used inside long-lived realtime callbacks.
  const guestNameRef = useRef<string | null>(null);
  const countdownStartedRef = useRef(false);
  const modeRef = useRef<"solo" | "host" | "guest">("solo");

  useEffect(() => {
    const stored = loadStoredPlayer();
    if (!stored) {
      setHydrating(false);
      return;
    }
    supabase
      .from("players")
      .select("*")
      .eq("id", stored.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setPlayer({ ...stored, ...(data as Player) });
        } else {
          setPlayer(stored);
        }
        setHydrating(false);
      });
  }, []);

  const handleEngineState = useCallback((s: PublicState) => {
    setGameState(s);
  }, []);

  // ---- Solo game over ----
  const handleSoloGameOver = useCallback(
    async (r: GameResult) => {
      setResult(r);
      if (!player) return;
      setSavingResult(true);
      const prevBest = player.best_score ?? 0;
      try {
        const updated = await submitGameResult(player, r);
        if (updated) {
          setPlayer({ ...player, ...updated });
        }
        setIsNewBest(r.score > prevBest);
      } catch (e) {
        console.error(e);
      } finally {
        setSavingResult(false);
      }
    },
    [player]
  );

  // ---- Co-op host game over ----
  const handleCoopHostGameOver = useCallback(
    async (r: GameResult) => {
      setResult(r);
      if (!player) return;
      const code = roomCode ?? "";
      const gName = guestName ?? "unknown";
      setSavingResult(true);
      try {
        await submitCoopResult({
          roomCode: code,
          hostUsername: player.username,
          guestUsername: gName,
          score: r.score,
          wave: r.wave,
          kills: r.kills,
        });
      } finally {
        setSavingResult(false);
      }
    },
    [player, roomCode, guestName]
  );

  const handleGameOver = useCallback(
    (r: GameResult) => {
      if (mode === "host") handleCoopHostGameOver(r);
      else if (mode === "guest") {
        // Guest doesn't submit (host does). Just store the result for the overlay.
        setResult(r);
      } else {
        handleSoloGameOver(r);
      }
    },
    [mode, handleSoloGameOver, handleCoopHostGameOver]
  );

  // ---- Snapshot routing ----
  const handleSnapshot = useCallback((s: CoopSnapshot) => {
    if (modeRef.current !== "host") return;
    hostHandleRef.current?.send({ type: "snapshot", s });
  }, []);
  // ---- Solo start ----
  const handleStart = useCallback(() => {
    setResult(null);
    setIsNewBest(false);
    setMode("solo");
    modeRef.current = "solo";
    engineRef.current?.setMode("solo", "");
    engineRef.current?.start();
  }, []);

  const handlePause = useCallback(() => engineRef.current?.pause(), []);
  const handleResume = useCallback(() => engineRef.current?.resume(), []);
  const handleToggleMute = useCallback(() => {
    const e = engineRef.current;
    if (e) e.setMuted(!e.isMuted());
  }, []);

  const handleSignIn = useCallback(async (username: string) => {
    const p = await signInOrCreate(username);
    setPlayer(p);
    return p;
  }, []);

  const handleSignOut = useCallback(() => {
    clearStoredPlayer();
    setPlayer(null);
    setResult(null);
    setIsNewBest(false);
  }, []);

  // ---- Multiplayer: host flow ----
  const startCountdownThenPlay = useCallback(() => {
    let value = 3;
    setCountdown(value);
    hostHandleRef.current?.send({ type: "countdown", value });
    const tick = () => {
      value -= 1;
      setCountdown(value);
      hostHandleRef.current?.send({ type: "countdown", value });
      if (value > 0) {
        setTimeout(tick, 1000);
      } else {
        // GO!
        setTimeout(() => {
          setCountdown(null);
          setScreen("playing");
          setResult(null);
          const gName = guestNameRef.current ?? "";
          engineRef.current?.setMode("host", gName);
          modeRef.current = "host";
          engineRef.current?.start();
        }, 700);
      }
    };
    setTimeout(tick, 1000);
  }, []);

  const startHosting = useCallback(async () => {
    if (!player) return;
    setJoinError(null);
    countdownStartedRef.current = false;
    try {
      const handle = await createHostRoom({
        onGuestJoin: (gName) => {
          guestNameRef.current = gName;
          setGuestName(gName);
          handle.send({ type: "welcome", hostUsername: player.username });
          if (!countdownStartedRef.current) {
            countdownStartedRef.current = true;
            setTimeout(() => startCountdownThenPlay(), 600);
          }
        },
        onGuestLeave: () => {
          guestNameRef.current = null;
          setGuestName(null);
        },
        onInput: (i) => {
          engineRef.current?.setRemoteInput(i.mvx, i.mvy, i.dash);
        },
      });
      hostHandleRef.current = handle;
      setMode("host");
      modeRef.current = "host";
      setRoomCode(handle.code);
      setHostName(player.username);
      setGuestName(null);
      setCountdown(null);
      setScreen("mp-host-lobby");
    } catch (e) {
      console.error(e);
      setJoinError("Could not open room. Try again.");
    }
  }, [player, startCountdownThenPlay]);

  // ---- Multiplayer: guest flow ----
  const joinAsGuest = useCallback(async (code: string) => {
    if (!player) return;
    setJoinError(null);
    setGuestStatus("connecting");
    try {
      const handle = await joinGuestRoom(code, {
        onWelcome: (hName) => {
          setHostName(hName);
          setGuestStatus("waiting");
          // Tell the engine who the partner is so HUD shows the right label
          engineRef.current?.setMode("guest", hName);
        },
        onSnapshot: (s) => {
          // If we were in lobby and the game has started, swap to playing screen
          setScreen((cur) => (cur === "mp-guest-lobby" && s.state === "playing" ? "playing" : cur));
          engineRef.current?.applySnapshot(s);
          if (s.state === "over") {
            // Game over from host
            setResult({ score: s.score, wave: s.wave, kills: s.kills });
          }
        },
        onCountdown: (v) => setCountdown(v),
        onHostLeave: () => {
          setJoinError("Host left the room.");
          cleanupMultiplayer();
          setScreen("playing");
        },
      });
      guestHandleRef.current = handle;
      setMode("guest");
      modeRef.current = "guest";
      setRoomCode(code);
      setGuestName(player.username);
      setHostName(null);
      setCountdown(null);
      engineRef.current?.setMode("guest", "");
      // Say hello to the host with our name
      handle.send({ type: "hello", username: player.username });
      setGuestStatus("waiting");
    } catch (e) {
      console.error(e);
      setGuestStatus("input");
      setJoinError("Couldn't join that room. Check the code.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  // ---- Cleanup ----
  function cleanupMultiplayer() {
    if (inputPumpRef.current !== null) {
      window.clearInterval(inputPumpRef.current);
      inputPumpRef.current = null;
    }
    if (hostHandleRef.current) {
      hostHandleRef.current.close();
      hostHandleRef.current = null;
    }
    if (guestHandleRef.current) {
      guestHandleRef.current.close();
      guestHandleRef.current = null;
    }
    setMode("solo");
    modeRef.current = "solo";
    setRoomCode(null);
    setHostName(null);
    setGuestName(null);
    guestNameRef.current = null;
    countdownStartedRef.current = false;
    setCountdown(null);
    setGuestStatus("input");
    setJoinError(null);
    engineRef.current?.setMode("solo", "");
  }

  const exitMultiplayer = useCallback(() => {
    cleanupMultiplayer();
    setScreen("playing");
    setResult(null);
  }, []);

  // ---- Guest input pump: 30Hz ----
  useEffect(() => {
    if (mode !== "guest") return;
    const id = window.setInterval(() => {
      const eng = engineRef.current;
      const handle = guestHandleRef.current;
      if (!eng || !handle) return;
      const i = eng.consumeLocalInput();
      handle.send({ type: "input", i: { ...i, ts: Date.now() } });
    }, 33);
    inputPumpRef.current = id;
    return () => {
      window.clearInterval(id);
      if (inputPumpRef.current === id) inputPumpRef.current = null;
    };
  }, [mode]);

  // ---- Cleanup on unmount ----
  useEffect(() => {
    return () => {
      if (hostHandleRef.current) hostHandleRef.current.close();
      if (guestHandleRef.current) guestHandleRef.current.close();
      if (inputPumpRef.current !== null) window.clearInterval(inputPumpRef.current);
    };
  }, []);

  // ---- Keyboard shortcut: solo only ----
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Enter") {
        if (!player) return;
        if (mode !== "solo") return;
        if (screen !== "playing") return;
        if (gameState.state === "menu" || gameState.state === "over") {
          handleStart();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [player, gameState.state, handleStart, mode, screen]);

  // Derive the result to show on a co-op game over
  const isCoopOver =
    (mode === "host" || mode === "guest") &&
    screen === "playing" &&
    gameState.state === "over" &&
    result !== null;

  return (
    <div className="fixed inset-0 overflow-hidden">
      <GameCanvas
        engineRef={engineRef}
        onState={handleEngineState}
        onGameOver={handleGameOver}
        onSnapshot={handleSnapshot}
      />
      <div className="vignette fixed inset-0 pointer-events-none z-[5]" />

      {player && (gameState.state === "playing" || gameState.state === "paused") && screen === "playing" && (
        <HUD
          state={gameState}
          username={player.username}
          onPause={handlePause}
          onToggleMute={handleToggleMute}
          onSignOut={handleSignOut}
        />
      )}

      {!hydrating && !player && (
        <SignInScreen
          signIn={handleSignIn}
          onSignedIn={() => { /* state updated inside handleSignIn */ }}
        />
      )}

      {player && screen === "playing" && gameState.state === "menu" && mode === "solo" && (
        <StartScreen
          player={player}
          onStart={handleStart}
          onMultiplayer={() => {
            setJoinError(null);
            setScreen("mp-choice");
          }}
          onSignOut={handleSignOut}
        />
      )}

      {player && screen === "playing" && gameState.state === "paused" && mode === "solo" && (
        <PauseScreen onResume={handleResume} />
      )}

      {player && screen === "playing" && gameState.state === "over" && result && !isCoopOver && (
        <GameOverScreen
          result={result}
          best={player.best_score ?? 0}
          isNewBest={isNewBest}
          saving={savingResult}
          playerId={player.id}
          onRetry={handleStart}
        />
      )}

      {player && isCoopOver && result && (
        <GameOverScreen
          result={result}
          best={0}
          isNewBest={false}
          saving={savingResult}
          playerId={player.id}
          onRetry={() => { /* unused */ }}
          isCoop
          hostUsername={mode === "host" ? player.username : hostName ?? "—"}
          guestUsername={mode === "host" ? guestName ?? "—" : player.username}
          onExitCoop={exitMultiplayer}
        />
      )}

      {player && screen === "mp-choice" && (
        <MultiplayerChoice
          onCreate={startHosting}
          onJoin={() => setScreen("mp-guest-lobby")}
          onCancel={() => setScreen("playing")}
        />
      )}

      {player && screen === "mp-host-lobby" && roomCode && (
        <HostLobby
          code={roomCode}
          hostName={player.username}
          guestName={guestName}
          countdown={countdown}
          onCancel={exitMultiplayer}
        />
      )}

      {player && screen === "mp-guest-lobby" && (
        <GuestLobby
          status={guestStatus}
          hostName={hostName}
          guestName={player.username}
          countdown={countdown}
          onSubmitCode={joinAsGuest}
          onCancel={exitMultiplayer}
          errorMsg={joinError}
        />
      )}
    </div>
  );
}
