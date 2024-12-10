export function lineArt(img, onImageData) {
  const worker = new Worker("./line-art/wasm-worker.js", { type: "module" });
  const canvas = document.createElement("canvas");
  canvas.style.display = "none";
  const width = img.width;
  const height = img.height;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  const dataArray = [];
  for (let i = 0; i < imageData.data.length; i += 4) {
    const pixel =
      (imageData.data[i] + imageData.data[i + 1] + imageData.data[i + 2]) / 3;
    dataArray.push(pixel / 255);
  }
  // reshape
  const reshapedData = [];
  for (let i = 0; i < height; i++) {
    reshapedData.push(dataArray.slice(i * width, (i + 1) * width));
  }
  setTimeout(() => {
    worker.postMessage(reshapedData);
  }, 100);

  worker.onmessage = (e) => {
    const imageData = ctx.createImageData(width, height);
    for (let i = 0; i < width * height; i++) {
      const pixel = Math.max(Math.min(e.data[i], 1), 0) * 255;
      imageData.data[i * 4] = pixel;
      imageData.data[i * 4 + 1] = pixel;
      imageData.data[i * 4 + 2] = pixel;
      imageData.data[i * 4 + 3] = 255;
    }
    onImageData(imageData, width, height);
  };
  return worker;
}
