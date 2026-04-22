import { FaceLandmarker, HandLandmarker, FilesetResolver, FaceLandmarkerResult, HandLandmarkerResult } from "@mediapipe/tasks-vision";

export interface TrackingData {
  face: {
    x: number; // -1 to 1 (head position)
    y: number; // -1 to 1
    z: number; // depth
    gazeX: number; // -1 to 1
    gazeY: number; // -1 to 1
  } | null;
  hands: {
    isPinching: boolean;
    x: number; // 0 to 1
    y: number; // 0 to 1
    landmarks: { x: number; y: number; z: number }[]; // Raw data
  }[];
}

export class Tracker {
  private faceLandmarker: FaceLandmarker | null = null;
  private handLandmarker: HandLandmarker | null = null;
  private lastVideoTime = -1;

  async init() {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm"
    );

    this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      outputFaceBlendshapes: true,
      minFaceDetectionConfidence: 0.3,
      minFacePresenceConfidence: 0.3,
      minTrackingConfidence: 0.3,
    });

    this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numHands: 1,
      minHandDetectionConfidence: 0.25, // More stable than 0.15
      minHandPresenceConfidence: 0.25,
      minTrackingConfidence: 0.25,
    });
    console.log("AI Models Initialized (GPU Mode)");
  }

  process(video: HTMLVideoElement, options: { processHands?: boolean } = {}): TrackingData {
    const now = performance.now();
    
    // Ensure video is ready and has dimensions
    if (video.currentTime === this.lastVideoTime || !video.videoWidth) {
      return { face: null, hands: [] };
    }
    this.lastVideoTime = video.currentTime;

    const faceResult = this.faceLandmarker?.detectForVideo(video, now);
    const handResult = (options.processHands !== false) ? this.handLandmarker?.detectForVideo(video, now) : null;

    return {
      face: this.parseFace(faceResult),
      hands: (options.processHands !== false) ? this.parseHands(handResult) : [],
    };
  }

  private parseFace(result?: FaceLandmarkerResult) {
    if (!result?.faceLandmarks || result.faceLandmarks.length === 0) return null;
    
    const landmarks = result.faceLandmarks[0];
    const nose = landmarks[4];
    
    // 1. Z Estimation (Stability first)
    const eyeL = landmarks[33];
    const eyeR = landmarks[263];
    const dx = eyeL.x - eyeR.x;
    const dy = eyeL.y - eyeR.y;
    const iodPixels = Math.sqrt(dx*dx + dy*dy);
    const estimatedZ = 0.15 / iodPixels; // Back to stable mapping

    let gazeX = 0;
    let gazeY = 0;
    
    if (result.faceBlendshapes && result.faceBlendshapes.length > 0) {
      const shapes = result.faceBlendshapes[0].categories;
      const lookLeft = (shapes.find(c => c.categoryName === 'eyeLookInRight')?.score || 0) + 
                        (shapes.find(c => c.categoryName === 'eyeLookOutLeft')?.score || 0);
      const lookRight = (shapes.find(c => c.categoryName === 'eyeLookInLeft')?.score || 0) + 
                         (shapes.find(c => c.categoryName === 'eyeLookOutRight')?.score || 0);
      const lookUp = shapes.find(c => c.categoryName === 'eyeLookUpLeft')?.score || 0;
      const lookDown = shapes.find(c => c.categoryName === 'eyeLookDownLeft')?.score || 0;
      
      gazeX = (lookRight - lookLeft) * 2;
      gazeY = (lookUp - lookDown) * 2;
    }

    return {
      x: (0.5 - nose.x) * 2, // RAW -1 to 1 for GameScene to handle
      y: (nose.y - 0.5) * -2,
      z: estimatedZ,
      gazeX,
      gazeY
    };
  }

  private parseHands(result?: HandLandmarkerResult) {
    if (!result?.landmarks) return [];

    return result.landmarks.map((hand) => {
      const wrist = hand[0];
      const tipIndices = [8, 12, 16, 20];
      const mcpIndices = [5, 9, 13, 17];
      
      let foldedFingers = 0;
      for (let i = 0; i < tipIndices.length; i++) {
        const tip = hand[tipIndices[i]];
        const mcp = hand[mcpIndices[i]];
        
        // Multi-axis distance for fist detection (more robust at distance)
        const dX = tip.x - wrist.x;
        const dY = tip.y - wrist.y;
        const dZ = tip.z - wrist.z;
        const tipDist = Math.sqrt(dX*dX + dY*dY + dZ*dZ);

        const mX = mcp.x - wrist.x;
        const mY = mcp.y - wrist.y;
        const mZ = mcp.z - wrist.z;
        const mcpDist = Math.sqrt(mX*mX + mY*mY + mZ*mZ);
        
        if (tipDist < mcpDist * 1.1) { // Adding a small buffer for distance jitter
          foldedFingers++;
        }
      }

      const isFist = foldedFingers >= 2; // Lowered from 3 to 2 for easier trigger at 2m distance

      return {
        isPinching: isFist,
        x: hand[9].x, 
        y: hand[9].y,
        landmarks: hand.map(l => ({ x: l.x, y: l.y, z: l.z }))
      };
    });
  }
}
