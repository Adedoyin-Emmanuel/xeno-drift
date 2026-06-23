import { useEffect, useRef } from "react";
import { GameEngine, type PublicState } from "../game/engine";
import type { CoopSnapshot } from "../lib/realtime";

type Props = {
  onState: (s: PublicState) => void;
  onGameOver: (result: { score: number; wave: number; kills: number }) => void;
  onSnapshot?: (s: CoopSnapshot) => void;
  engineRef: React.MutableRefObject<GameEngine | null>;
};

export function GameCanvas({ onState, onGameOver, onSnapshot, engineRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Pin latest callbacks so we don't re-create the engine when they change.
  const onStateRef = useRef(onState);
  const onGameOverRef = useRef(onGameOver);
  const onSnapshotRef = useRef(onSnapshot);
  onStateRef.current = onState;
  onGameOverRef.current = onGameOver;
  onSnapshotRef.current = onSnapshot;

  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new GameEngine(canvasRef.current, {
      onState: (s) => onStateRef.current(s),
      onGameOver: (r) => onGameOverRef.current(r),
      onSnapshot: (s) => onSnapshotRef.current?.(s),
    });
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 block w-full h-full"
      style={{ touchAction: "none" }}
    />
  );
}
