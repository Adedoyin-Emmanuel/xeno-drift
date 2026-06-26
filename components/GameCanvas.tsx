import { useEffect, useRef } from "react";
import { GameEngine, type PublicState } from "../game/engine";
import type { CoopSnapshot } from "../lib/realtime";

type Props = {
  onState: (s: PublicState) => void;
  onGameOver: (result: { score: number; wave: number; kills: number }) => void;
  onSnapshot?: (s: CoopSnapshot) => void;
  onDuckMusic?: (active: boolean) => void;
  engineRef: React.MutableRefObject<GameEngine | null>;
};

export function GameCanvas({ onState, onGameOver, onSnapshot, onDuckMusic, engineRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onStateRef = useRef(onState);
  const onGameOverRef = useRef(onGameOver);
  const onSnapshotRef = useRef(onSnapshot);
  const onDuckMusicRef = useRef(onDuckMusic);
  onStateRef.current = onState;
  onGameOverRef.current = onGameOver;
  onSnapshotRef.current = onSnapshot;
  onDuckMusicRef.current = onDuckMusic;

  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new GameEngine(canvasRef.current, {
      onState: (s) => onStateRef.current(s),
      onGameOver: (r) => onGameOverRef.current(r),
      onSnapshot: (s) => onSnapshotRef.current?.(s),
      onDuckMusic: (a) => onDuckMusicRef.current?.(a),
    });
    engineRef.current = engine;
    return () => engine.dispose();
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 block w-full h-full cursor-none"
      style={{ touchAction: "none" }}
    />
  );
}
