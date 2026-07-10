'use strict';
const path = require('path');
const fs = require('fs');
const Jimp = require('jimp');

const MODEL_PATH = path.join(__dirname, '..', '..', 'assets', 'models', 'u2net.onnx');
const SIZE = 320;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

let sessionPromise = null;

function isModelAvailable() {
  return fs.existsSync(MODEL_PATH);
}

async function getSession() {
  if (!sessionPromise) {
    const ort = require('onnxruntime-node');
    sessionPromise = ort.InferenceSession.create(MODEL_PATH);
  }
  return sessionPromise;
}

// Returns a Buffer of a transparent PNG with the background removed.
async function removeBackground(imagePath) {
  if (!isModelAvailable()) throw new Error('Background-removal model not installed.');
  const ort = require('onnxruntime-node');
  const session = await getSession();

  const original = await Jimp.read(imagePath);
  const ow = original.bitmap.width;
  const oh = original.bitmap.height;

  // Resize copy to 320x320 for the network.
  const small = original.clone().resize(SIZE, SIZE, Jimp.RESIZE_BILINEAR);
  const d = small.bitmap.data; // RGBA
  // Find max pixel value (U^2-Net divides by max, not by 255).
  let maxVal = 1e-6;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] > maxVal) maxVal = d[i];
    if (d[i + 1] > maxVal) maxVal = d[i + 1];
    if (d[i + 2] > maxVal) maxVal = d[i + 2];
  }
  // Build CHW float tensor with mean/std normalization.
  const input = new Float32Array(3 * SIZE * SIZE);
  const plane = SIZE * SIZE;
  for (let p = 0, j = 0; p < d.length; p += 4, j++) {
    const r = d[p] / maxVal, g = d[p + 1] / maxVal, b = d[p + 2] / maxVal;
    input[j] = (r - MEAN[0]) / STD[0];
    input[plane + j] = (g - MEAN[1]) / STD[1];
    input[2 * plane + j] = (b - MEAN[2]) / STD[2];
  }
  const tensor = new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]);
  const feeds = { [session.inputNames[0]]: tensor };
  const results = await session.run(feeds);
  const out = results[session.outputNames[0]].data; // length SIZE*SIZE (channel 0)

  // Normalize saliency map to 0..1.
  let mi = Infinity, ma = -Infinity;
  for (let i = 0; i < plane; i++) { if (out[i] < mi) mi = out[i]; if (out[i] > ma) ma = out[i]; }
  const range = (ma - mi) || 1e-6;

  // Build a 320x320 grayscale mask image, then resize to original size.
  const mask = new Jimp(SIZE, SIZE, 0x000000ff);
  for (let i = 0; i < plane; i++) {
    const v = Math.round(((out[i] - mi) / range) * 255);
    const idx = i * 4;
    mask.bitmap.data[idx] = v;
    mask.bitmap.data[idx + 1] = v;
    mask.bitmap.data[idx + 2] = v;
    mask.bitmap.data[idx + 3] = 255;
  }
  mask.resize(ow, oh, Jimp.RESIZE_BILINEAR);

  // Apply mask as alpha on a copy of the original.
  const result = original.clone();
  const rd = result.bitmap.data;
  const md = mask.bitmap.data;
  for (let i = 0; i < rd.length; i += 4) {
    rd[i + 3] = md[i]; // use mask's red channel as alpha
  }
  return result.getBufferAsync(Jimp.MIME_PNG);
}

module.exports = { isModelAvailable, removeBackground, MODEL_PATH };
