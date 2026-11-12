(function (root) {
  "use strict";

  const modelId = "Xenova/segformer-b2-finetuned-ade-512-512";
  const runtimeUrl = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js";
  const palette = [[215, 215, 215], [0, 185, 45], [160, 222, 30], [0, 207, 239], [241, 149, 153]];
  let worker;

  function workerMain(runtimeUrl, modelId) {
    const classGroup = { tree:1, grass:2, plant:2, sky:3, building:4, house:4 };
    let runtime, segmenter;

    self.onmessage = async ({ data: { pixels, width, height } }) => {
      let phase = "loading";
      try {
        if (!segmenter) {
          self.postMessage({ phase });
          runtime = await import(runtimeUrl);
          runtime.env.allowLocalModels = false;
          runtime.env.backends.onnx.wasm.numThreads = 1;
          segmenter = await runtime.pipeline("image-segmentation", modelId, { dtype:"q8", device:"wasm" });
        }
        phase = "analysing";
        self.postMessage({ phase });
        const photo = new runtime.RawImage(new Uint8ClampedArray(pixels), width, height, 3);
        const segments = await segmenter(photo);
        if (!segments.length) throw Error("Empty segmentation output");
        const groups = new Uint8Array(width * height);
        for (const { label, mask } of segments) {
          const group = Object.hasOwn(classGroup, label) ? classGroup[label] : 0;
          if (!group) continue;
          if (mask.width !== width || mask.height !== height || mask.data.length !== groups.length) {
            throw Error("Unexpected mask dimensions");
          }
          for (let i = 0; i < groups.length; i++) if (mask.data[i]) groups[i] = group;
        }
        self.postMessage({ groups }, [groups.buffer]);
      } catch (error) {
        self.postMessage({ failed:phase, detail:String(error?.stack ?? error) });
      }
    };
  }

  function segment(pixels, width, height, onProgress) {
    return new Promise((resolve, reject) => {
      if (!worker) {
        const source = `(${workerMain.toString()})(${JSON.stringify(runtimeUrl)}, ${JSON.stringify(modelId)});`;
        const url = URL.createObjectURL(new Blob([source], { type:"text/javascript" }));
        try { worker = new Worker(url, { type:"module" }); }
        finally { URL.revokeObjectURL(url); }
      }

      function finish(error, groups) {
        clearTimeout(timeout);
        worker.onmessage = worker.onerror = null;
        if (error) {
          worker.terminate();
          worker = null;
          reject(Error(error));
        } else resolve(groups);
      }

      const timeout = setTimeout(() => finish("Analysis timed out. Check your connection and try again."), 180000);
      worker.onmessage = ({ data }) => {
        if (data.phase) onProgress(data.phase);
        else if (data.groups) finish(null, data.groups);
        else {
          console.error("SegFormer", data.failed, data.detail);
          finish(data.failed === "loading"
            ? "The model could not load. Check your connection, then try again."
            : "The model could not analyse this photo. Try again or choose another image.");
        }
      };
      worker.onerror = () => finish("The analysis engine could not start. Try an up-to-date browser.");
      worker.postMessage({ pixels:pixels.buffer, width, height }, [pixels.buffer]);
    });
  }

  async function analyse(file, onProgress) {
    if (!/\.(?:jpe?g|png|webp)$/i.test(file.name) && !/^image\/(jpeg|png|webp)$/.test(file.type)) {
      throw Error("Choose a JPG, PNG or WebP photo.");
    }
    if (file.size > 20 * 1024 ** 2) throw Error("Choose a photo under 20 MB.");
    const photo = await createImageBitmap(file).catch(() => { throw Error("This photo could not be opened. Try a different image."); });
    const canvas = document.createElement("canvas");
    const factor = Math.min(1, 768 / Math.max(photo.width, photo.height));
    const width = canvas.width = Math.max(1, Math.round(photo.width * factor));
    const height = canvas.height = Math.max(1, Math.round(photo.height * factor));
    const ctx = canvas.getContext("2d", { alpha:false, willReadFrequently:true });
    try {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(photo, 0, 0, width, height);
    } finally { photo.close(); }
    const original = canvas.toDataURL("image/jpeg", .9);
    const rgba = ctx.getImageData(0, 0, width, height).data;
    const rgb = new Uint8ClampedArray(width * height * 3);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
      rgb[j] = rgba[i];
      rgb[j + 1] = rgba[i + 1];
      rgb[j + 2] = rgba[i + 2];
    }

    const start = performance.now();
    const groups = await segment(rgb, width, height, onProgress);
    const counts = [0, 0, 0, 0, 0];
    const mask = document.createElement("canvas");
    mask.width = width;
    mask.height = height;
    const maskCtx = mask.getContext("2d");
    const colours = maskCtx.createImageData(width, height);
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      colours.data.set(palette[group], i * 4);
      colours.data[i * 4 + 3] = 255;
      counts[group]++;
    }
    maskCtx.putImageData(colours, 0, 0);
    ctx.globalAlpha = .43;
    ctx.drawImage(mask, 0, 0);
    const pct = count => Math.round(10000 * count / groups.length) / 100;
    return {
      original_image:original, mask_image:mask.toDataURL("image/png"), overlay_image:canvas.toDataURL("image/jpeg", .9),
      tree_pct:pct(counts[1]), other_vegetation_pct:pct(counts[2]), vegetation_pct:pct(counts[1] + counts[2]),
      sky_pct:pct(counts[3]), buildings_pct:pct(counts[4]), model_name:modelId, model_revision:"ONNX q8",
      analysis_width:width, analysis_height:height, analysis_seconds:Math.round((performance.now() - start) / 100) / 10,
      analysis_timestamp:new Date().toISOString(),
    };
  }

  root.CanopyPhotoAnalysis = { analyse };
})(globalThis);
