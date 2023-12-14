import { Delaunay } from "./delaunay.js";

function HRTFContainer() {
  var hrir = {};
  var triangulation = {
    points: [],
    triangles: [],
  };

  this.loadHRIR = function (file, onLoad) {
    var oReq = new XMLHttpRequest();
    oReq.open("GET", file, true);
    oReq.responseType = "arraybuffer";
    oReq.onload = function (oEvent) {
      var arrayBuffer = oReq.response;
      if (arrayBuffer) {
        var rawData = new Float32Array(arrayBuffer);
        var ir = {};
        ir.L = {};
        ir.R = {};
        var azimuths = [
          -90, -80, -65, -55, -45, -40, -35, -30, -25, -20, -15, -10, -5, 0, 5,
          10, 15, 20, 25, 30, 35, 40, 45, 55, 65, 80, 90,
        ];
        var points = [];

        var hrirLength = 200;
        var k = 0;
        for (var i = 0; i < azimuths.length; ++i) {
          var azi = azimuths[i];
          ir["L"][azi] = {};
          ir["R"][azi] = {};

          // -90 deg elevation
          ir["L"][azi][-90] = rawData.subarray(k, k + hrirLength);
          k += hrirLength;
          ir["R"][azi][-90] = rawData.subarray(k, k + hrirLength);
          k += hrirLength;

          points.push([azi, -90]);
          // 50 elevations: -45 + 5.625 * (0:49)
          for (var j = 0; j < 50; ++j) {
            var elv = -45 + 5.625 * j;
            ir["L"][azi][elv] = rawData.subarray(k, k + hrirLength);
            k += hrirLength;
            ir["R"][azi][elv] = rawData.subarray(k, k + hrirLength);
            k += hrirLength;
            points.push([azi, elv]);
          }

          // 270 deg elevation
          ir["L"][azi][270] = rawData.subarray(k, k + hrirLength);
          k += hrirLength;
          ir["R"][azi][270] = rawData.subarray(k, k + hrirLength);
          k += hrirLength;
          points.push([azi, 270]);
        }

        hrir = ir;
        triangulation.triangles = Delaunay.triangulate(points);
        triangulation.points = points;
        if (typeof onLoad !== "undefined") onLoad();
      } else {
        throw new Error("Failed to load HRIR");
      }
    };
    oReq.send(null);
  };

  this.interpolateHRIR = function (azm, elv) {
    var triangles = triangulation.triangles;
    var points = triangulation.points;
    var i = triangles.length - 1;
    var A, B, C, X, T, invT, det, g1, g2, g3;
    while (true) {
      A = points[triangles[i]];
      i--;
      B = points[triangles[i]];
      i--;
      C = points[triangles[i]];
      i--;
      T = [A[0] - C[0], A[1] - C[1], B[0] - C[0], B[1] - C[1]];
      invT = [T[3], -T[1], -T[2], T[0]];
      det = 1 / (T[0] * T[3] - T[1] * T[2]);
      for (var j = 0; j < invT.length; ++j) invT[j] *= det;
      X = [azm - C[0], elv - C[1]];
      g1 = invT[0] * X[0] + invT[2] * X[1];
      g2 = invT[1] * X[0] + invT[3] * X[1];
      g3 = 1 - g1 - g2;
      if (g1 >= 0 && g2 >= 0 && g3 >= 0) {
        var hrirL = new Float32Array(200);
        var hrirR = new Float32Array(200);
        for (var i = 0; i < 200; ++i) {
          hrirL[i] =
            g1 * hrir["L"][A[0]][A[1]][i] +
            g2 * hrir["L"][B[0]][B[1]][i] +
            g3 * hrir["L"][C[0]][C[1]][i];
          hrirR[i] =
            g1 * hrir["R"][A[0]][A[1]][i] +
            g2 * hrir["R"][B[0]][B[1]][i] +
            g3 * hrir["R"][C[0]][C[1]][i];
        }
        return [hrirL, hrirR];
      } else if (i < 0) {
        break;
      }
    }
    return [new Float32Array(200), new Float32Array(200)];
  };
}

function HRTFPanner(audioContext, sourceNode, hrtfContainer) {
  function HRTFConvolver() {
    this.buffer = audioContext.createBuffer(2, 200, audioContext.sampleRate);
    this.convolver = audioContext.createConvolver();
    this.convolver.normalize = false;
    this.convolver.buffer = this.buffer;

    this.gainNode = audioContext.createGain();
    this.convolver.connect(this.gainNode);

    this.fillBuffer = function (hrirLR) {
      var bufferL = this.buffer.getChannelData(0);
      var bufferR = this.buffer.getChannelData(1);
      for (var i = 0; i < this.buffer.length; ++i) {
        bufferL[i] = hrirLR[0][i];
        bufferR[i] = hrirLR[1][i];
      }
      this.convolver.buffer = this.buffer;
    };
  }

  var currentConvolver = new HRTFConvolver();
  var targetConvolver = new HRTFConvolver();

  var loPass = audioContext.createBiquadFilter();
  var hiPass = audioContext.createBiquadFilter();

  loPass.type = "lowpass";
  loPass.frequency.value = 200;
  hiPass.type = "highpass";
  hiPass.frequency.value = 200;

  var source = sourceNode;
  source.channelCount = 1;
  // source.connect(loPass);
  source.connect(hiPass);

  source.connect(currentConvolver.convolver);
  source.connect(targetConvolver.convolver);
  // hiPass.connect(currentConvolver.convolver);
  // hiPass.connect(targetConvolver.convolver);

  /* Connects this panner to the desination node. */
  this.connect = function (destNode) {
    // loPass.connect(destNode);
    currentConvolver.gainNode.connect(destNode);
    targetConvolver.gainNode.connect(destNode);
  };

  /* Connects a new source to this panner and disconnects the previous one. */
  // this.setSource = function (newSource) {
  //   // source.disconnect(loPass);
  //   // source.disconnect(hiPass);
  //   // newSource.disconnect(loPass);
  //   // newSource.disconnect(hiPass);
  //   source = newSource;
  // };

  /* Set a cut-off frequency below which input signal won't be spacialized. */
  this.setCrossoverFrequency = function (frequency) {
    loPass.frequency.value = frequency;
    hiPass.frequency.value = frequency;
  };

  /* Update the current HRTF. Amimuth and elevation are coordinates of the source
   * in the Interaural-Polar coordinates system RELATIVE to the listener.
   * This is supposed to be called each time a listener or source position changes.
   */
  this.update = function (azimuth, elevation) {
    targetConvolver.fillBuffer(hrtfContainer.interpolateHRIR(azimuth, elevation));
    // var crossfadeDuration = 25;
    // targetConvolver.gainNode.gain.setValueAtTime(0, audioContext.currentTime);
    // targetConvolver.gainNode.gain.linearRampToValueAtTime(
    //   1,
    //   audioContext.currentTime + crossfadeDuration / 1000
    // );
    // currentConvolver.gainNode.gain.setValueAtTime(0, audioContext.currentTime);
    // currentConvolver.gainNode.gain.linearRampToValueAtTime(
    //   1,
    //   audioContext.currentTime + crossfadeDuration / 1000
    // );
    // swap convolvers
    var t = targetConvolver;
    targetConvolver = currentConvolver;
    currentConvolver = t;
  };
}

function cartesianToInteraural(x1, x2, x3) {
  var r = Math.sqrt(x1 * x1 + x2 * x2 + x3 * x3);
  var azm = rad2deg(Math.asin(x1 / r));
  var elv = rad2deg(Math.atan2(x3, x2));
  if (x2 < 0 && x3 < 0) elv += 360;
  return { r: r, azm: azm, elv: elv };
}

function interauralToCartesian(r, azm, elv) {
  azm = deg2rad(azm);
  elv = deg2rad(elv);
  var x1 = r * Math.sin(azm);
  var x2 = r * Math.cos(azm) * Math.cos(elv);
  var x3 = r * Math.cos(azm) * Math.sin(elv);
  return { x1: x1, x2: x2, x3: x3 };
}

function deg2rad(deg) {
  return (deg * Math.PI) / 180;
}

function rad2deg(rad) {
  return (rad * 180) / Math.PI;
}

export { HRTFContainer, HRTFPanner, cartesianToInteraural };
