import { useCallback, useEffect, useRef, useState } from "react";
import { GameCanvas } from "./components/GameCanvas";
import { HUD } from "./components/HUD";
import {
  SignInScreen,
  StartScreen,
  PauseScreen,
  GameOverScreen,
  LeaderboardScreen,
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
  type GameResult,
} from "./lib/player";
import { supabase, type Player } from "./lib/supabase";
import {
  initMusic,
  playMusic,
  restartMusic,
  pauseMusic,
  resumeMusic,
  duckMusic,
} from "./lib/sounds";
import {
  createHostRoom,
  joinGuestRoom,
  type CoopSnapshot,
  type HostHandle,
  type GuestHandle,
} from "./lib/realtime";

type Screen = "playing" | "mp-choice" | "mp-host-lobby" | "mp-guest-lobby" | "leaderboard";

const INITIAL_STATE: PublicState = {
  state: "menu",
  score: 0,
  hp: 100,
  maxHp: 100,
  dashCd: 0,
  dashMax: 1.4,
  muted: false,
  wave: 0,
  kills: 0,
};

function loadBestScore(): number {
  try {
    const raw = localStorage.getItem("xenoDriftBest");
    return raw ? parseInt(raw, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

function saveBestScore(score: number) {
  try {
    localStorage.setItem("xenoDriftBest", String(score));
  } catch {}
}

export default function App() {
  const engineRef = useRef<GameEngine | null>(null);
  const [gameState, setGameState] = useState<PublicState>(INITIAL_STATE);
  const [player, setPlayer] = useState<(StoredPlayer & Partial<Player>) | null>(null);
  const [hydrating, setHydrating] = useState(true);
  const [result, setResult] = useState<GameResult | null>(null);
  const [savingResult, setSavingResult] = useState(false);
  const [bestScore, setBestScore] = useState(loadBestScore);
  const [isNewBest, setIsNewBest] = useState(false);

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
  const guestNameRef = useRef<string | null>(null);
  const countdownStartedRef = useRef(false);
  const modeRef = useRef<"solo" | "host" | "guest">("solo");

  useEffect(() => {
    const syncRoute = () => {
      const isLeaderboardRoute = window.location.pathname === "/leaderboard";
      setScreen((current) => {
        if (isLeaderboardRoute) return "leaderboard";
        return current === "leaderboard" ? "playing" : current;
      });
    };
    syncRoute();
    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, []);

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
        if (data) setPlayer({ ...stored, ...(data as Player) });
        else setPlayer(stored);
        setHydrating(false);
      });
  }, []);

  useEffect(() => {
    initMusic();
    playMusic();
  }, []);

  const handleDuckMusic = useCallback((active: boolean) => {
    duckMusic(active);
  }, []);

  const handleEngineState = useCallback((s: PublicState) => setGameState(s), []);

  const handleGameOver = useCallback(
    async (r: GameResult) => {
      setResult(r);
      // Track best score locally
      const current = loadBestScore();
      if (r.score > current) {
        saveBestScore(r.score);
        setBestScore(r.score);
        setIsNewBest(true);
      } else {
        setBestScore(current);
        setIsNewBest(false);
      }
      if (!player) return;
      if (modeRef.current === "host" || modeRef.current === "solo") {
        setSavingResult(true);
        try {
          const updated = await submitGameResult(player, r);
          if (updated) setPlayer({ ...player, ...updated });
        } catch (e) {
          console.error(e);
        } finally {
          setSavingResult(false);
        }
      }
    },
    [player]
  );

  const handleSnapshot = useCallback((s: CoopSnapshot) => {
    if (modeRef.current !== "host" && modeRef.current !== "solo") return;
    hostHandleRef.current?.send({ type: "snapshot", s });
  }, []);

  const handlePractice = useCallback(() => {
    setResult(null);
    setIsNewBest(false);
    setMode("solo");
    modeRef.current = "solo";
    engineRef.current?.setMode("solo", "");
    engineRef.current?.start();
    restartMusic();
  }, []);

  const handlePause = useCallback(() => engineRef.current?.pause(), []);
  const handleResume = useCallback(() => engineRef.current?.resume(), []);
  const handleTogglePause = useCallback(() => {
    const e = engineRef.current;
    if (!e) return;
    if (e.getState() === "playing") e.pause();
    else if (e.getState() === "paused") e.resume();
  }, []);

  const handleGoToMenu = useCallback(() => {
    engineRef.current?.goToMenu();
    cleanupMultiplayer();
    setResult(null);
    setIsNewBest(false);
    setScreen("playing");
    restartMusic();
  }, []);

  const handleToggleMute = useCallback(() => {
    const e = engineRef.current;
    if (e) {
      e.setMuted(!e.isMuted());
      if (e.isMuted()) {
        pauseMusic();
      } else {
        resumeMusic();
      }
    }
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
    setScreen("playing");
    cleanupMultiplayer();
  }, []);

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
        setTimeout(() => {
          setCountdown(null);
          setScreen("playing");
          setResult(null);
          setIsNewBest(false);
          const gName = guestNameRef.current ?? "";
          engineRef.current?.setMode("host", gName);
          modeRef.current = "host";
          engineRef.current?.start();
          restartMusic();
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
          engineRef.current?.setRemoteInput(i.mvx, i.mvy, i.dash, i.aim);
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

  const joinAsGuest = useCallback(
    async (code: string) => {
      if (!player) return;
      setJoinError(null);
      setGuestStatus("connecting");
      try {
        const handle = await joinGuestRoom(code, {
          onWelcome: (hName) => {
            setHostName(hName);
            setGuestStatus("waiting");
            engineRef.current?.setMode("guest", hName);
          },
          onSnapshot: (s) => {
            setScreen((cur) =>
              cur === "mp-guest-lobby" && s.state === "playing" ? "playing" : cur
            );
            engineRef.current?.applySnapshot(s);
            if (s.state === "over") {
              const r = { score: s.guest.score, wave: s.wave, kills: s.guest.score };
              setResult(r);
              const current = loadBestScore();
              if (r.score > current) { saveBestScore(r.score); setBestScore(r.score); setIsNewBest(true); }
              else { setBestScore(current); setIsNewBest(false); }
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
        handle.send({ type: "hello", username: player.username });
        setGuestStatus("waiting");
      } catch (e) {
        console.error(e);
        setGuestStatus("input");
        setJoinError("Could not join that room. Check the code.");
      }
    },
    [player]
  );

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

  useEffect(() => {
    if (mode !== "guest") return;
    const id = window.setInterval(() => {
      const eng = engineRef.current;
      const handle = guestHandleRef.current;
      if (!eng || !handle) return;
      const i = eng.consumeLocalInput();
      handle.send({ type: "input", i: { mvx: i.mvx, mvy: i.mvy, dash: i.dash, aim: i.aim, fire: true, ts: Date.now() } });
    }, 33);
    inputPumpRef.current = id;
    return () => {
      window.clearInterval(id);
      if (inputPumpRef.current === id) inputPumpRef.current = null;
    };
  }, [mode]);

  useEffect(() => {
    return () => {
      if (hostHandleRef.current) hostHandleRef.current.close();
      if (guestHandleRef.current) guestHandleRef.current.close();
      if (inputPumpRef.current !== null) window.clearInterval(inputPumpRef.current);
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Enter") {
        if (!player) return;
        if (modeRef.current !== "solo") return;
        if (screen !== "playing") return;
        if (gameState.state === "menu" || gameState.state === "over") {
          handlePractice();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [player, gameState.state, handlePractice, screen]);

  const isGameOver =
    screen === "playing" && gameState.state === "over" && result !== null;

  const showHUD =
    player &&
    (gameState.state === "playing" || gameState.state === "paused") &&
    screen === "playing";

  return (
    <div className="fixed inset-0 overflow-hidden">
      <GameCanvas
        engineRef={engineRef}
        onState={handleEngineState}
        onGameOver={handleGameOver}
        onSnapshot={handleSnapshot}
        onDuckMusic={handleDuckMusic}
      />
      <div className="vignette fixed inset-0 pointer-events-none z-[5]" />

      {showHUD && (
        <HUD
          gameState={gameState}
          onToggleMute={handleToggleMute}
          onSignOut={handleSignOut}
          onExitPractice={handleGoToMenu}
          onTogglePause={handleTogglePause}
        />
      )}

      {!hydrating && !player && (
        <SignInScreen signIn={handleSignIn} onSignedIn={() => {}} />
      )}

      {player &&
        screen === "playing" &&
        !isGameOver &&
        gameState.state !== "playing" &&
        gameState.state !== "paused" && (
          <StartScreen
            player={player}
            onStart={handlePractice}
            onMultiplayer={() => { setJoinError(null); setScreen("mp-choice"); }}
            onLeaderboard={() => { window.history.pushState({}, "", "/leaderboard"); setScreen("leaderboard"); }}
            onSignOut={handleSignOut}
          />
        )}

      {player && screen === "playing" && gameState.state === "paused" && (
        <PauseScreen onResume={handleResume} onMenu={handleGoToMenu} />
      )}

      {player && isGameOver && result && (
        <GameOverScreen
          result={result}
          bestScore={bestScore}
          isNewBest={isNewBest}
          partnerScore={gameState.partnerScore}
          onMenu={handleGoToMenu}
          onRetry={handlePractice}
        />
      )}

      {player && screen === "leaderboard" && (
        <LeaderboardScreen onBack={() => { window.history.pushState({}, "", "/"); setScreen("playing"); }} currentUsername={player.username} />
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
          guestName={guestName}
          countdown={countdown}
          onSubmitCode={joinAsGuest}
          onCancel={exitMultiplayer}
          errorMsg={joinError}
        />
      )}
    </div>
  );
}
