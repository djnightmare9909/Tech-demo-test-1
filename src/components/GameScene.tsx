import { useRef, useState, useMemo, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera, Float, Sphere, Text, MeshDistortMaterial } from '@react-three/drei';
import * as THREE from 'three';
import { TrackingData } from '../lib/tracking';

interface Target {
  id: string;
  position: [number, number, number];
  color: string;
  seed: number;
}

function TargetMesh({ target, onHit, isLocked }: { target: Target; onHit: (id: string) => void, isLocked: boolean }) {
  const meshRef = useRef<THREE.Mesh>(null);
  
  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += isLocked ? 0.05 : 0.01;
      meshRef.current.position.y += Math.sin(state.clock.elapsedTime + target.seed) * (isLocked ? 0.02 : 0.005);
      
      if (isLocked) {
        const s = 1 + Math.sin(state.clock.elapsedTime * 10) * 0.1;
        meshRef.current.scale.set(s, s, s);
      } else {
        meshRef.current.scale.set(1, 1, 1);
      }
    }
  });

  return (
    <Float speed={isLocked ? 4 : 2} rotationIntensity={isLocked ? 2 : 1} floatIntensity={isLocked ? 2 : 1}>
      <Sphere
        ref={meshRef}
        args={[0.4, 16, 16]}
        position={target.position}
        name={target.id}
      >
        <MeshDistortMaterial
          color={isLocked ? '#ffffff' : target.color}
          speed={isLocked ? 5 : 3}
          distort={isLocked ? 0.6 : 0.4}
          roughness={0}
          emissive={isLocked ? '#ffffff' : '#000000'}
          emissiveIntensity={isLocked ? 2 : 0}
        />
      </Sphere>
    </Float>
  );
}

function GameController({ 
  tracking, 
  onScore,
  onLockChange
}: { 
  tracking: TrackingData, 
  onScore: () => void,
  onLockChange: (locked: boolean) => void
}) {
  const { camera, scene, raycaster, size } = useThree();
  const [targets, setTargets] = useState<Target[]>([]);
  const [lockedTargetId, setLockedTargetId] = useState<string | null>(null);
  const lastPinchRef = useRef<boolean>(false);
  
  // Use a Ref for tracking to avoid stale closures in useFrame
  const trackingRef = useRef(tracking);
  trackingRef.current = tracking;

  // Spawn targets
  useEffect(() => {
    const interval = setInterval(() => {
      setTargets(prev => {
        if (prev.length < 8) {
          return [
            ...prev,
            {
              id: `target-${Math.random().toString(36).substr(2, 9)}`,
              position: [
                (Math.random() - 0.5) * 15,
                (Math.random() - 0.5) * 10,
                -Math.random() * 20 - 2, // Spread targets from Z=-2 down to Z=-22 (back of room)
              ] as [number, number, number],
              color: `hsl(${Math.random() * 360}, 80%, 60%)`,
              seed: Math.random() * 10,
            }
          ];
        }
        return prev;
      });
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  useFrame((state) => {
    const currentTracking = trackingRef.current;
    
    // 1. SMOOTH PORTAL PEERING
    // We target a position based on face, or center if lost
    const targetX = currentTracking.face ? currentTracking.face.x * 4.5 : 0;
    const targetY = currentTracking.face ? currentTracking.face.y * 3.5 : 0;
    const targetZ = currentTracking.face ? Math.max(3, currentTracking.face.z * 6) : 8;

    // Smoothly lerp camera position to eliminate jitter
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetX, 0.15);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, targetY, 0.15);
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetZ, 0.15);

    // 2. OFF-AXIS FRUSTUM (Pinned to screen edges at Z=0)
    const aspectRatio = size.width / size.height;
    const worldWidth = 10; 
    const worldHeight = worldWidth / aspectRatio;
    
    const near = 0.1;
    const far = 1000;
    const ratio = near / camera.position.z;
    
    const left = (-worldWidth / 2 - camera.position.x) * ratio;
    const right = (worldWidth / 2 - camera.position.x) * ratio;
    const bottom = (-worldHeight / 2 - camera.position.y) * ratio;
    const top = (worldHeight / 2 - camera.position.y) * ratio;

    camera.projectionMatrix.makePerspective(left, right, top, bottom, near, far);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();

    // 3. HAND RAYCASTING
    let isCurrentlyPinching = false;
    currentTracking.hands.forEach(hand => {
      const nx = ((1 - hand.x) - 0.5) * 2; 
      const ny = (0.5 - hand.y) * 2; 
      
      const pointer = new THREE.Vector2(nx, ny);
      
      if (hand.isPinching) {
        isCurrentlyPinching = true;
        if (!lastPinchRef.current) {
          raycaster.setFromCamera(pointer, camera);
          const intersects = raycaster.intersectObjects(scene.children, true);
          const hit = intersects.find(i => i.object.name.startsWith('target-'));
          if (hit) handleHit(hit.object.name);
        }
      }

      // HOVER/LOCK-ON logic
      raycaster.setFromCamera(pointer, camera);
      const hover = raycaster.intersectObjects(scene.children, true).find(i => i.object.name.startsWith('target-'));
      const nextId = hover ? hover.object.name : null;
      if (nextId !== lockedTargetId) {
        setLockedTargetId(nextId);
        onLockChange(!!nextId);
      }
    });

    if (currentTracking.hands.length === 0 && lockedTargetId) {
      setLockedTargetId(null);
      onLockChange(false);
    }

    lastPinchRef.current = isCurrentlyPinching;
  });

  const handleHit = (id: string) => {
    setTargets(prev => prev.filter(t => t.id !== id));
    setLockedTargetId(null);
    onScore();
  };

  return (
    <>
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} intensity={1} />
      {targets.map(target => (
        <TargetMesh 
          key={target.id} 
          target={target} 
          onHit={handleHit} 
          isLocked={lockedTargetId === target.id} 
        />
      ))}
    </>
  );
}

function Room() {
  return (
    <group position={[0, 0, -10]}>
      {/* Floor */}
      <mesh position={[0, -10, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color="#0a0f1a" roughness={0.8} />
      </mesh>
      <gridHelper args={[40, 20, '#1e293b', '#111827']} position={[0, -9.9, 0]} />

      {/* Ceiling */}
      <mesh position={[0, 10, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color="#050812" />
      </mesh>

      {/* Back Wall */}
      <mesh position={[0, 0, -20]}>
        <planeGeometry args={[40, 20]} />
        <meshStandardMaterial color="#02040a" />
      </mesh>
      <gridHelper args={[40, 20, '#1e1b4b', '#0f172a']} position={[0, 0, -19.9]} rotation={[Math.PI / 2, 0, 0]} />

      {/* Decorative Corner Pillars */}
      <mesh position={[-19.5, 0, 0]}>
        <boxGeometry args={[1, 20, 40]} />
        <meshStandardMaterial color="#0f172a" />
      </mesh>
      <mesh position={[19.5, 0, 0]}>
        <boxGeometry args={[1, 20, 40]} />
        <meshStandardMaterial color="#0f172a" />
      </mesh>

      {/* Distant glow points for orientation */}
      <pointLight position={[-15, 8, -15]} intensity={0.5} color="#4f46e5" />
      <pointLight position={[15, -8, -15]} intensity={0.5} color="#ec4899" />
    </group>
  );
}

export default function GameScene({ 
  tracking, 
  onScore,
  onLockChange
}: { 
  tracking: TrackingData, 
  onScore: () => void,
  onLockChange: (locked: boolean) => void
}) {
  return (
    <Canvas shadows style={{ background: 'transparent' }}>
      <PerspectiveCamera makeDefault position={[0, 0, 5]} fov={75} />
      <color attach="background" args={['#020408']} />
      
      <GameController tracking={tracking} onScore={onScore} onLockChange={onLockChange} />
      
      <Room />
      
      <ambientLight intensity={0.4} />
      <pointLight position={[0, 10, -5]} intensity={4} color="#4f46e5" />
      <pointLight position={[-15, -5, -10]} intensity={2} color="#1e1b4b" />
    </Canvas>
  );
}
