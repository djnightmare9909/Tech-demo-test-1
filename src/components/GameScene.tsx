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
        args={[0.4, 32, 32]}
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

  // Spawn targets
  useEffect(() => {
    const interval = setInterval(() => {
      setTargets(prev => {
        if (prev.length < 15) {
          return [
            ...prev,
            {
              id: `target-${Math.random().toString(36).substr(2, 9)}`,
              position: [
                (Math.random() - 0.5) * 15,
                (Math.random() - 0.5) * 10,
                -Math.random() * 15 - 5,
              ] as [number, number, number],
              color: `hsl(${Math.random() * 360}, 80%, 60%)`,
              seed: Math.random() * 10,
            }
          ];
        }
        return prev;
      });
    }, 800);
    return () => clearInterval(interval);
  }, []);

  useFrame(() => {
    // 1. TRUE WINDOW EFFECT (Off-axis Projection)
    // Map tracking to world units (assuming screen is ~20 units wide)
    if (tracking.face) {
      const worldWidth = 20;
      const worldHeight = worldWidth / (size.width / size.height);
      
      // Face coordinates map to eye position in front of screen
      const eyeX = tracking.face.x * (worldWidth / 2);
      const eyeY = tracking.face.y * (worldHeight / 2);
      // estimatedZ from tracking is a world unit estimation
      const eyeZ = Math.max(5, tracking.face.z * 10); 

      camera.position.set(eyeX, eyeY, eyeZ);

      // TRUE OFF-AXIS PROJECTION
      const near = 0.1;
      const far = 1000;
      const ratio = near / eyeZ;
      const left = (-worldWidth / 2 - eyeX) * ratio;
      const right = (worldWidth / 2 - eyeX) * ratio;
      const bottom = (-worldHeight / 2 - eyeY) * ratio;
      const top = (worldHeight / 2 - eyeY) * ratio;

      camera.projectionMatrix.makePerspective(left, right, top, bottom, near, far);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    }

    // 2. PINCH DETECTION & RAYCASTING
    let isCurrentlyPinching = false;
    tracking.hands.forEach(hand => {
      if (hand.isPinching) {
        isCurrentlyPinching = true;
        if (!lastPinchRef.current) {
          const nx = (hand.x - 0.5) * 2;
          const ny = (hand.y - 0.5) * -2;
          raycaster.setFromCamera(new THREE.Vector2(nx, ny), camera);
          const intersects = raycaster.intersectObjects(scene.children, true);
          const hit = intersects.find(i => i.object.name.startsWith('target-'));
          if (hit) handleHit(hit.object.name);
        }
      }
    });

    // 3. HOVER LOCK
    if (tracking.hands.length > 0) {
      const mainHand = tracking.hands[0];
      raycaster.setFromCamera(new THREE.Vector2((mainHand.x - 0.5) * 2, (mainHand.y - 0.5) * -2), camera);
      const hover = raycaster.intersectObjects(scene.children, true).find(i => i.object.name.startsWith('target-'));
      const nextId = hover ? hover.object.name : null;
      if (nextId !== lockedTargetId) {
        setLockedTargetId(nextId);
        onLockChange(!!nextId);
      }
    } else {
      if (lockedTargetId) {
        setLockedTargetId(null);
        onLockChange(false);
      }
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
      <color attach="background" args={['#050608']} />
      <fog attach="fog" args={['#050608', 8, 20]} />
      
      <GameController tracking={tracking} onScore={onScore} onLockChange={onLockChange} />
      
      {/* Decorative Grid for depth perception */}
      <gridHelper 
        args={[40, 40, '#1e293b', '#0f172a']} 
        rotation={[Math.PI / 2, 0, 0]} 
        position={[0, 0, -15]} 
      />
      
      {/* Distant ambient light to catch edges */}
      <pointLight position={[-10, -10, -10]} intensity={0.5} color="#22d3ee" />
    </Canvas>
  );
}
