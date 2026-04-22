/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import { Tracker, TrackingData } from './lib/tracking';
import GameScene from './components/GameScene';
import { motion, AnimatePresence } from 'motion/react';
import { Camera, Target, Hand, Maximize, RefreshCw } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [trackingData, setTrackingData] = useState<TrackingData>({ face: null, hands: [] });
  const [score, setScore] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isGazeLocked, setIsGazeLocked] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const trackerRef = useRef<Tracker | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const init = async () => {
      try {
        trackerRef.current = new Tracker();
        await trackerRef.current.init();
        
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720, facingMode: 'user' },
        });
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        
        setIsLoading(false);
      } catch (err: any) {
        console.error(err);
        setError("Camera access or AI model failed to load.");
        setIsLoading(false);
      }
    };

    init();
  }, []);

  const isProcessingRef = useRef(false);

  const gameLoop = async () => {
    if (trackerRef.current && videoRef.current && !isProcessingRef.current) {
      isProcessingRef.current = true;
      try {
        const data = trackerRef.current.process(videoRef.current);
        setTrackingData(data);
      } finally {
        isProcessingRef.current = false;
      }
    }
    rafRef.current = requestAnimationFrame(gameLoop);
  };

  useEffect(() => {
    rafRef.current = requestAnimationFrame(gameLoop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying]);

  const handleStart = () => setIsPlaying(true);

  // Derive dynamic HUD values from tracking data
  const eyeLockStatus = isGazeLocked ? "LOCKED" : (trackingData.face ? "STABLE" : "SEARCHING");
  const fovDepth = trackingData.face ? (1.5 + trackingData.face.z * 0.5).toFixed(2) : "0.00";

  return (
    <div className="relative w-full h-screen bg-[#050608] text-slate-100 font-sans overflow-hidden select-none">
      {/* Hidden Video Feed for Processing (Needs actual size for MediaPipe) */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="fixed opacity-0 pointer-events-none"
        style={{ width: '320px', height: '240px' }}
      />

      {/* Perspective Background (The Portal) */}
      <div className="absolute inset-0 opacity-40 pointer-events-none z-0">
        <div className="absolute inset-0 border-[40px] border-slate-900/50 z-10 transition-transform duration-500" 
             style={{ transform: trackingData.face ? `translate(${trackingData.face.x * 40}px, ${trackingData.face.y * 40}px)` : 'none' }}></div>
        <div className="absolute inset-0 bg-gradient-to-tr from-indigo-900/20 via-slate-900 to-emerald-900/20"></div>
        <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(circle, #1e293b 1px, transparent 1px)', backgroundSize: '80px 80px', transform: 'perspective(800px) rotateX(20deg) translateY(-50px)' }}></div>
      </div>

      {/* 3D Game Canvas */}
      <div className="absolute inset-0 z-0">
        <GameScene 
          tracking={trackingData} 
          onScore={() => setScore(s => s + 100)} 
          onLockChange={setIsGazeLocked}
        />
      </div>

      {/* HUD Overlay */}
      <div className="absolute inset-0 z-10 pointer-events-none p-8 flex flex-col justify-between">
        <div className="absolute top-4 left-1/2 -translate-x-1/2 text-[9px] font-mono text-white/20 uppercase tracking-[0.5em]">
          Face Raiders Next-Gen v1.0.4a
        </div>

        {/* Top HUD */}
        <div className="flex justify-between items-start">
          <div className="flex flex-col gap-1">
            <div className="text-[10px] font-mono tracking-widest text-cyan-500 flex items-center gap-2">
              <span className={cn("w-2 h-2 rounded-full shadow-[0_0_5px_cyan]", eyeLockStatus === 'SEARCHING' ? 'bg-red-500' : 'bg-cyan-500')}></span>
              MOTOROLA EDGE 2025 5G | SPATIAL MODE
            </div>
            
            <div className="bg-slate-900/80 backdrop-blur-md border border-slate-700 p-3 rounded-lg flex gap-4 mt-2">
              <div className="flex flex-col">
                <span className="text-[10px] text-slate-500 uppercase font-mono">Gaze Targeting</span>
                <span className={cn("text-lg font-bold transition-colors", eyeLockStatus === 'LOCKED' ? 'text-white' : (eyeLockStatus === 'STABLE' ? 'text-cyan-400' : 'text-slate-500'))}>
                  {eyeLockStatus}
                </span>
              </div>
              <div className="w-[1px] bg-slate-700"></div>
              <div className="flex flex-col">
                <span className="text-[10px] text-slate-500 uppercase font-mono">FOV Depth</span>
                <span className="text-lg font-bold text-slate-200">{fovDepth}m</span>
              </div>
            </div>
          </div>

          <div className="text-right">
            <div className="text-5xl font-black text-white italic tracking-tighter drop-shadow-[0_0_15px_rgba(255,255,255,0.2)]">
              {score.toLocaleString()}
            </div>
            <div className="text-[10px] font-mono text-fuchsia-500 tracking-tighter uppercase mt-1 leading-none">
              High Score: 12,000
            </div>
          </div>
        </div>

        {/* Interaction Helper / Player Feed */}
        <div className="absolute left-8 bottom-32 w-40 aspect-video bg-slate-900/40 backdrop-blur-md border border-slate-700 rounded-xl overflow-hidden group pointer-events-auto">
          <video
            ref={(el) => {
              if (el && videoRef.current?.srcObject) {
                el.srcObject = videoRef.current.srcObject;
              }
            }}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover grayscale opacity-30 transition-opacity group-hover:opacity-60"
          />
          {/* Skeleton Overlay */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-50 overflow-visible">
            {trackingData.hands.map((hand, hi) => (
              <g key={hi}>
                {hand.landmarks.map((l, li) => (
                  <circle key={li} cx={`${l.x * 100}%`} cy={`${l.y * 100}%`} r="1" fill="#22d3ee" />
                ))}
                {/* Simplified bones */}
                <line x1={`${hand.landmarks[0].x * 100}%`} y1={`${hand.landmarks[0].y * 100}%`} x2={`${hand.landmarks[1].x * 100}%`} y2={`${hand.landmarks[1].y * 100}%`} stroke="#22d3ee" strokeWidth="0.5" />
                <line x1={`${hand.landmarks[1].x * 100}%`} y1={`${hand.landmarks[1].y * 100}%`} x2={`${hand.landmarks[2].x * 100}%`} y2={`${hand.landmarks[2].y * 100}%`} stroke="#22d3ee" strokeWidth="0.5" />
                <line x1={`${hand.landmarks[5].x * 100}%`} y1={`${hand.landmarks[5].y * 100}%`} x2={`${hand.landmarks[9].x * 100}%`} y2={`${hand.landmarks[9].y * 100}%`} stroke="#22d3ee" strokeWidth="0.5" />
              </g>
            ))}
          </svg>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-cyan-500/20">
             <Target size={32} />
          </div>
          <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-slate-950/80 rounded text-[7px] font-mono uppercase tracking-[0.2em] text-cyan-500/70 border border-cyan-500/20">
            Hand/Face Tracker
          </div>
        </div>

        {/* Hand Cursors (Finger Dot + Pop Effect) */}
        <AnimatePresence>
          {trackingData.hands.map((hand, i) => (
            <motion.div
              key={i}
              className="fixed z-50 pointer-events-none flex items-center justify-center"
              animate={{ 
                x: hand.x * window.innerWidth, 
                y: hand.y * window.innerHeight,
              }}
              transition={{ type: 'spring', damping: 20, stiffness: 200 }}
            >
              {/* THE DOT */}
              <motion.div 
                className={cn(
                  "w-4 h-4 rounded-full shadow-[0_0_15px_rgba(255,255,255,0.8)] border border-white",
                  hand.isPinching ? "bg-white scale-150" : "bg-cyan-500/50 scale-100"
                )}
                animate={{ scale: hand.isPinching ? 1.5 : 1 }}
              />

              {/* THE POP EFFECT */}
              <AnimatePresence>
                {hand.isPinching && (
                  <motion.div 
                    className="absolute w-20 h-20 border-2 border-white rounded-full translate-x-[-50%] translate-y-[-50%]"
                    initial={{ scale: 0.5, opacity: 1 }}
                    animate={{ scale: 2, opacity: 0 }}
                    exit={{ opacity: 0 }}
                    style={{ left: '50%', top: '50%' }}
                  />
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Bottom HUD: Interactive Prompts */}
        <div className="flex justify-center items-end gap-12 mb-4">
          <div className="flex flex-col items-center opacity-40">
            <div className="w-10 h-10 border border-slate-700 rounded-lg flex items-center justify-center text-lg bg-slate-900/50 grayscale">🤜</div>
            <span className="text-[9px] uppercase mt-2 tracking-[0.2em] font-mono">Melee</span>
          </div>
          
          <div className="flex flex-col items-center border-b-2 border-cyan-500 px-10 py-3 bg-cyan-500/5 rounded-t-xl transition-all">
            <div className="flex items-center gap-4 mb-1">
               <span className="text-lg opacity-40">👀</span>
               <div className="w-12 h-[1px] bg-cyan-500/20"></div>
               <span className="text-lg">🤏</span>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-cyan-400">Gaze Lock + Pinch</span>
          </div>

          <div className="flex flex-col items-center opacity-40">
            <div className="w-10 h-10 border border-slate-700 rounded-lg flex items-center justify-center text-lg bg-slate-900/50 grayscale">🤏</div>
            <span className="text-[9px] uppercase mt-2 tracking-[0.2em] font-mono">Grab</span>
          </div>
        </div>
      </div>

      {/* Screen Vignette */}
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle,transparent_40%,rgba(0,0,0,0.4)_100%)] z-20"></div>

      {/* Start Overlay */}
      {!isPlaying && (
        <div className="absolute inset-0 z-30 bg-slate-950/90 backdrop-blur-2xl flex items-center justify-center pointer-events-auto">
          <motion.div 
            className="max-w-md w-full p-10 text-center space-y-8"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            <div className="relative inline-block">
              <Target className="text-cyan-500" size={72} />
              <div className="absolute inset-[-20px] border border-cyan-500/20 rounded-full animate-ping"></div>
            </div>
            
            <div className="space-y-3">
              <h2 className="text-6xl font-black italic uppercase tracking-tighter text-white">READY?</h2>
              <p className="text-slate-400 text-sm leading-relaxed max-w-[280px] mx-auto">
                <span className="text-cyan-400 font-mono text-[10px] uppercase tracking-widest block mb-2">Instructions</span>
                Move your head to peer through the portal. Use <span className="text-white font-bold">Finger Pinch</span> gestures to pop the intruders.
              </p>
            </div>

            {isLoading ? (
              <div className="flex flex-col items-center gap-4">
                <RefreshCw className="animate-spin text-cyan-500" size={32} />
                <p className="text-[9px] font-mono uppercase tracking-[0.3em] text-slate-500">Syncing AI Subsystems...</p>
              </div>
            ) : error ? (
              <div className="p-4 bg-red-950/30 border border-red-500/30 rounded-xl text-red-500 text-xs font-mono italic">
                {error}
              </div>
            ) : (
              <button
                onClick={handleStart}
                className="group relative w-full bg-cyan-500 text-black py-5 rounded-xl font-black uppercase tracking-[0.2em] overflow-hidden transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                <span className="relative z-10 flex items-center justify-center gap-3">
                  Initiate Spatial Stream <Maximize size={20} />
                </span>
                <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-20 transition-opacity"></div>
              </button>
            )}
          </motion.div>
        </div>
      )}
    </div>
  );
}
