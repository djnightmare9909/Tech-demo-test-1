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
        delegate: "GPU", // Switch back to GPU for 60fps performance
      },
      runningMode: "VIDEO",
      outputFaceBlendshapes: true,
    });

    this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
        delegate: "GPU", // Switch back to GPU
      },
      runningMode: "VIDEO",
      numHands: 2,
    });
    console.log("AI Models Initialized (GPU Mode)");
  }

  process(video: HTMLVideoElement): TrackingData {
    const now = performance.now();
    
    // Ensure video is ready and has dimensions
    if (video.currentTime === this.lastVideoTime || !video.videoWidth) {
      return { face: null, hands: [] };
    }
    this.lastVideoTime = video.currentTime;

    const faceResult = this.faceLandmarker?.detectForVideo(video, now);
    const handResult = this.handLandmarker?.detectForVideo(video, now);

    return {
      face: this.parseFace(faceResult),
      hands: this.parseHands(handResult),
    };
  }

  private parseFace(result?: FaceLandmarkerResult) {
    if (!result?.faceLandmarks || result.faceLandmarks.length === 0) return null;
    
    const landmarks = result.faceLandmarks[0];
    const nose = landmarks[4];
    
    // Estimate distance using inter-ocular distance (Landmarks 33 and 263 are eyes)
    const eyeL = landmarks[33];
    const eyeR = landmarks[263];
    const dx = eyeL.x - eyeR.x;
    const dy = eyeL.y - eyeR.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    
    // A typical inter-ocular distance in real world is ~63mm.
    // In image space, the smaller the dist, the further away the head.
    // This provides a much more stable Z than landmarks[4].z
    const estimatedZ = 0.15 / dist; // Simple inverse mapping for world units

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
      x: (nose.x - 0.5) * 2,
      y: (nose.y - 0.5) * -2,
      z: estimatedZ,
      gazeX,
      gazeY
    };
  }

  private parseHands(result?: HandLandmarkerResult) {
    if (!result?.landmarks) return [];

    return result.landmarks.map((hand) => {
      const thumbTip = hand[4];
      const indexTip = hand[8];
      
      // Calculate Euclidean distance between thumb and index tips
      const dist = Math.sqrt(
        Math.pow(thumbTip.x - indexTip.x, 2) +
        Math.pow(thumbTip.y - indexTip.y, 2) +
        Math.pow(thumbTip.z - indexTip.z, 2)
      );

      return {
        isPinching: dist < 0.05,
        x: indexTip.x,
        y: indexTip.y,
        landmarks: hand.map(l => ({ x: l.x, y: l.y, z: l.z }))
      };
    });
  }
}
