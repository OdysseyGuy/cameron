import vision from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";
const { FaceLandmarker, FilesetResolver } = vision;

import { HRTFContainer, HRTFPanner } from "./hrtf.js";

try {
  var audioContext = new (window.AudioContext || window.webkitAudioContext)();
} catch (e) {
  console.error("Web Audio API is not supported in this browser");
}

let hrtfContainer = new HRTFContainer();
hrtfContainer.loadHRIR("../../assets/hrir/kemar_L.bin");

var audioPlayer = document.getElementById("audio-player");
var source = audioContext.createMediaElementSource(audioPlayer);

let gain = audioContext.createGain();
gain.gain.value = 1.0;
source.connect(gain);

let panner = new HRTFPanner(audioContext, gain, hrtfContainer);
panner.connect(audioContext.destination);

let headtrackingEnabled = false;
var headTrackingButton = document.getElementById("tracking-btn");
headTrackingButton.addEventListener("click", function () {
  if (this.dataset.tracking === "on") {
    headtrackingEnabled = false;
    this.dataset.tracking = "off";
  } else if (this.dataset.tracking === "off") {
    headtrackingEnabled = true;
    this.dataset.tracking = "on";
  }
  this.innerHTML = `Head Tracking: ${this.dataset.tracking}`;
});

var az = 0,
  ev = 0;
var xPos = document.getElementById("x-pos");
xPos.addEventListener("change", function (event) {
  az = event.target.value;
  console.log(az);
  // panner.update(az, ev);
});

var yPos = document.getElementById("y-pos");
yPos.addEventListener("input", function (event) {
  ev = event.target.value;
  console.log(ev);
  // panner.update(az, ev);
});

setInterval(function () {
  panner.update(xPos.value, yPos.value);
}, 50);

var powerBtn = document.getElementById("power-btn");
var playBtn = document.getElementById("play-btn");

var crsFreq = document.getElementById("crs-freq");
crsFreq.addEventListener("change", function (event) {
  const freq = event.target.value;
  console.log(`Crossover frequency changed to: ${freq} Hz`);
  panner.setCrossoverFrequency(freq);
});

powerBtn.addEventListener("click", function () {
  if (this.dataset.power === "on") {
    audioContext.suspend();
    this.dataset.power = "off";
  } else if (this.dataset.power === "off") {
    audioContext.resume();
    this.dataset.power = "on";
  }
  this.innerHTML = `Power: ${this.dataset.power}`;
});

playBtn.addEventListener("click", function () {
  if (audioContext.state === "suspended") {
    audioContext.resume();
  }

  if (this.dataset.playing === "false") {
    audioPlayer.play();
    this.dataset.playing = "true";
    this.innerHTML = "Pause";
  } else if (this.dataset.playing === "true") {
    audioPlayer.pause();
    this.dataset.playing = "false";
    this.innerHTML = "Play";
  }

  let state = this.getAttribute("aria-checked") === "true" ? true : false;
  this.setAttribute("aria-checked", state ? "false" : "true");
});

let faceLandmarker;
let enableWebcamButton;
let webcamRunning = false;
let videoWidth = 480;

async function createFaceLandmarker() {
  const filesetResover = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
  );
  faceLandmarker = await FaceLandmarker.createFromOptions(filesetResover, {
    baseOptions: {
      modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
      delegate: "GPU",
    },
    outputFacialTransformationMatrixes: true,
    runningMode: "VIDEO",
    numFaces: 1,
  });
}

createFaceLandmarker();

const video = document.getElementById("webcam");
const yawVal = document.getElementById("yaw-val");
const pitchVal = document.getElementById("pitch-val");
const rollVal = document.getElementById("roll-val");

// Check if webcam access is supported.
function hasGetUserMedia() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

if (hasGetUserMedia()) {
  enableWebcamButton = document.getElementById("webcamButton");
  enableWebcamButton.addEventListener("click", enableCam);
} else {
  console.warn("getUserMedia() is not supported by your browser");
}

// Enable the live webcam view and start detection.
let lastVideoTime = -1;
function enableCam(event) {
  if (!faceLandmarker) {
    console.log("Wait! faceLandmarker is not ready yet");
    return;
  }

  if (webcamRunning === true) {
    webcamRunning = false;
    enableWebcamButton.innerHTML = "Start Webcam";
  } else {
    webcamRunning = true;
    enableWebcamButton.innerHTML = "Stop Webcam";
  }

  // getUserMedia parameters
  const constraints = {
    video: true,
  };

  // Activate the webcam stream
  navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
    video.srcObject = stream;
    video.addEventListener("loadeddata", predictWebcam);
  });

  const ratio = video.height / video.width;
  video.style.wdith = videoWidth + "px";
  video.style.height = videoWidth * ratio + "px";
  faceLandmarker.setOptions({ runningMode: "VIDEO" });
}

// Start face landmarker prediction
let results = undefined;
async function predictWebcam() {
  let startTimeMs = performance.now();
  if (lastVideoTime) {
    lastVideoTime = video.currentTime;
    results = faceLandmarker.detectForVideo(video, startTimeMs);
  }
  if (results.facialTransformationMatrixes && headtrackingEnabled) {
    const matrixArr = results.facialTransformationMatrixes;
    if (matrixArr.length) {
      estimateFaceOrientation(results.facialTransformationMatrixes[0].data);
    }
  }
  if (webcamRunning) {
    window.requestAnimationFrame(predictWebcam);
  }
}

const YAW_SENSITIVITY = 1.3;
const NOISE_ANGLE = 3;

let prevYaw = 0;
let prevRoll = 0;
let prevPitch = 0;
function estimateFaceOrientation(mat) {
  const yaw = Math.atan2(
    -mat[8],
    Math.sqrt(mat[9] * mat[9] + mat[10] * mat[10])
  );
  const pitch = Math.atan2(mat[9], mat[10]);
  const roll = Math.atan2(mat[4], mat[0]);

  const yawAngle = (yaw * 180) / Math.PI;
  const pitchAngle = (pitch * 180) / Math.PI;
  const rollAngle = (roll * 180) / Math.PI;

  prevRoll = roll;

  const sensiitised_yaw = yawAngle * YAW_SENSITIVITY;
  const sensiitised_pitch = pitchAngle * YAW_SENSITIVITY;
  if (
    (Math.abs(sensiitised_yaw - prevYaw) >= NOISE_ANGLE ||
      Math.abs(sensiitised_yaw - prevYaw)) &&
    headtrackingEnabled
  ) {
    prevYaw = sensiitised_yaw;
    prevPitch = sensiitised_pitch;

    az = Math.min(Math.max(-sensiitised_yaw, -90), 90);
    ev = Math.min(Math.max(sensiitised_pitch, -90), 90);
    xPos.value = az;
    yPos.value = ev;

    yawVal.innerHTML = yawAngle;
    pitchVal.innerHTML = pitchAngle;
    rollVal.innerHTML = rollAngle;
  }
}
